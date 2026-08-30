#!/usr/bin/env node
// A bridge, so an agent that speaks MCP can join a room that speaks WebMCP.
//
//   claude mcp add clawroom -- node scripts/clawroom-mcp.mjs "<room link>"
//   codex mcp add clawroom -- node scripts/clawroom-mcp.mjs "<room link>"
//
// What it deliberately does not do is reimplement the room. There is no copy
// of the tier engine here, no list of tool names, no idea what a campaign is.
// It opens the room in a real Chrome, asks the page what tools it has with
// getTools(), and calls them with executeTool(). Everything a caller sees is
// the page's own tool surface, which means a borrowed source that a person
// approved thirty seconds ago shows up here too, and a commit-tier call parks
// for a human exactly as it does in the browser.
//
// That is the whole argument for building it this way. If this file held the
// tools, the room would have two enforcement points and one of them would
// drift. It holds none, so it cannot.
//
// Chrome does the work because WebMCP lives in a document. Point it at a
// browser you are already running with a debugging port, or let it start its
// own headless one.
//
// The same file has an away mode, for when you want the work to carry on
// without you:
//
//   node scripts/clawroom-mcp.mjs "<room link>" --away "draft two options and
//     submit the better one"
//
// Run that on any machine that is not your laptop and the room is simply open
// somewhere else: its own in-page agent does the task, its commit-tier calls
// park for a person, and you read the log in the morning. There is no second
// engine anywhere in this file, in either mode. That is the point.

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOM = process.argv[2] ?? process.env['CLAWROOM_ROOM'] ?? ''
const PORT = Number(process.env['CDP_PORT'] ?? 9222)
const CHROME = process.env['CHROME'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HEADFUL = process.env['CLAWROOM_HEADFUL'] === '1'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.error('[clawroom-mcp]', ...a)

if (!ROOM) {
  log('usage: node scripts/clawroom-mcp.mjs "https://clawroom.../room.html?r=..&k=.."')
  process.exit(2)
}

// ---------------------------------------------------------------- the browser

async function chromeIsUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(700) })
    return r.ok
  } catch { return false }
}

async function ensureChrome() {
  if (await chromeIsUp()) { log(`using the Chrome already on port ${PORT}`); return null }
  const profile = mkdtempSync(join(tmpdir(), 'clawroom-mcp-'))
  const args = [
    ...(HEADFUL ? [] : ['--headless=new']),
    '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    'about:blank',
  ]
  const child = spawn(CHROME, args, { stdio: 'ignore', detached: false })
  for (let i = 0; i < 60; i++) { if (await chromeIsUp()) { log('started Chrome'); return child } await sleep(250) }
  throw new Error(`Chrome did not come up on port ${PORT}. Set CHROME to its path.`)
}

/** One page, one CDP socket, and Runtime.evaluate wrapped so every expression
 *  can use await. */
async function openRoom() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  let id = 0
  const waiting = new Map()
  const send = (method, params = {}) =>
    new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  ws.addEventListener('message', m => {
    const d = JSON.parse(String(m.data))
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id) }
  })
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: ROOM })

  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? 'the page threw')
    }
    return r.result?.result?.value
  }

  for (let i = 0; i < 80; i++) {
    const ready = await evaluate('return typeof document.modelContext !== "undefined" && (await document.modelContext.getTools()).length > 0')
    if (ready) return { evaluate, close: () => send('Page.close') }
    await sleep(500)
  }
  throw new Error('the room never registered any tools. Is the link right, and is this Chrome 151 or newer?')
}

// ------------------------------------------------------------------ the tools

/** Chrome 151 hands inputSchema back as a string even though the spec now says
 *  object. Take either, because the day it changes this should keep working. */
function asSchema(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { /* below */ } }
  return { type: 'object', properties: {} }
}

async function listTools(page) {
  const tools = await page.evaluate(`
    const ts = await document.modelContext.getTools()
    return ts.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  `)
  return (tools ?? []).map(t => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: asSchema(t.inputSchema),
  }))
}

async function callTool(page, name, args) {
  const out = await page.evaluate(`
    const mc = document.modelContext
    const handle = (await mc.getTools()).find(t => t.name === ${JSON.stringify(name)})
    if (!handle) return { missing: true }
    const raw = await mc.executeTool(handle, ${JSON.stringify(JSON.stringify(args ?? {}))})
    return { raw: typeof raw === 'string' ? raw : JSON.stringify(raw) }
  `)
  if (out?.missing) {
    return { content: [{ type: 'text', text: `This room has no tool called ${name}. Call tools/list again: a room's surface changes when a person approves a new source.` }], isError: true }
  }
  // executeTool resolves to the result envelope as a JSON string, so unwrap.
  let env = out?.raw
  try { env = JSON.parse(env) } catch { return { content: [{ type: 'text', text: String(out?.raw ?? '') }] } }
  const content = Array.isArray(env?.content) ? env.content : [{ type: 'text', text: String(env ?? '') }]
  return { content, ...(env?.structuredContent !== undefined ? { structuredContent: env.structuredContent } : {}) }
}

// ------------------------------------------------------------------- the wire

const INSTRUCTIONS =
  'You are joining a ClawRoom: a shared room where several people each bring their own agent. ' +
  'Every tool call you make lands in a log the whole room reads, so it is a commit rather than a private step. ' +
  'Read each tool description before calling it, because the description says where its payload goes. ' +
  'Some tools do nothing until a person approves them and answer with a handle instead; that is not an error, ' +
  'and you should carry on with other work or report back rather than retrying. ' +
  'The set of tools can change while you are connected, when somebody in the room approves a new source.'

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function handle(page, msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return {
      protocolVersion: params?.protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'clawroom', version: '1.0.0' },
      instructions: INSTRUCTIONS,
    }
  }
  if (method === 'tools/list') return { tools: await listTools(page) }
  if (method === 'tools/call') return await callTool(page, params?.name, params?.arguments)
  if (method === 'ping') return {}
  throw Object.assign(new Error(`no method ${method}`), { code: -32601 })
}

async function serve(page) {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async chunk => {
    buf += chunk
    let cut
    while ((cut = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, cut).trim()
      buf = buf.slice(cut + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      // A notification has no id and wants no answer.
      if (msg.id === undefined) continue
      try {
        write({ jsonrpc: '2.0', id: msg.id, result: await handle(page, msg) })
      } catch (e) {
        write({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32000, message: String(e?.message ?? e) } })
      }
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

// A client of its own, so the bridge can be proved without a coding agent
// attached. Drives one room end to end and prints what came back.
async function selftest(page) {
  const tools = await listTools(page)
  console.log(`tools/list returned ${tools.length}`)
  console.log(tools.slice(0, 8).map(t => `  ${t.name}`).join('\n'))
  const has = n => tools.some(t => t.name === n)

  if (has('list_posts')) {
    const r = await callTool(page, 'list_posts', {})
    console.log('\nlist_posts:\n  ' + r.content.map(c => c.text).join('\n').split('\n').slice(0, 3).join('\n  '))
  }
  if (has('draft_post')) {
    const r = await callTool(page, 'draft_post', {
      itemId: 'post_1', headline: 'Same work, less of your evening', body: 'A draft written by an agent that has never seen this code.',
    })
    console.log('\ndraft_post:\n  ' + r.content.map(c => c.text).join(' ').slice(0, 140))
  }
  if (has('submit_for_review')) {
    const r = await callTool(page, 'submit_for_review', { itemId: 'post_1', which: 1 })
    console.log('\nsubmit_for_review:\n  ' + r.content.map(c => c.text).join(' ').slice(0, 140))
  }
  if (has('publish')) {
    const r = await callTool(page, 'publish', { itemId: 'post_1' })
    const text = r.content.map(c => c.text).join('\n')
    console.log('\npublish:\n  ' + text.split('\n').slice(0, 3).join('\n  '))
    const handleId = text.match(/handle=(\S+)/)?.[1]
    if (handleId && has('check_approval')) {
      const c = await callTool(page, 'check_approval', { handle: handleId })
      console.log('\ncheck_approval:\n  ' + c.content.map(x => x.text).join(' '))
    }
  }
  console.log('\nThe bridge holds no tools of its own. Every line above went through the page.')
}

// Away mode. The room's own agent does the work; this script types the task
// and watches. Everything that happens is a tool call the page made, so the
// tiers hold and a commit still waits for a human.
async function away(page, task) {
  const provider = process.env['CLAWROOM_MODEL_BASE'] && process.env['CLAWROOM_MODEL_KEY']
    ? {
        base: process.env['CLAWROOM_MODEL_BASE'],
        key: process.env['CLAWROOM_MODEL_KEY'],
        model: process.env['CLAWROOM_MODEL'] ?? 'gpt-5',
      }
    : null
  if (provider) {
    await page.evaluate(`localStorage.setItem('clawroom:model', ${JSON.stringify(JSON.stringify(provider))}); location.reload(); return 1`)
    await sleep(3000)
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate('return !!document.getElementById("say")')) break
      await sleep(500)
    }
    log(`using ${provider.model}`)
  }

  const before = await page.evaluate('return document.querySelectorAll("#feed > *").length')
  await page.evaluate(`
    const i = document.getElementById('say')
    if (!i) return false
    i.value = ${JSON.stringify(task)}
    document.getElementById('send').click()
    return true
  `)
  log('handed the task to the room')

  const until = Date.now() + 1000 * 60 * 10
  while (Date.now() < until) {
    const busy = await page.evaluate('return !!document.querySelector("#send[disabled]")')
    if (!busy) break
    await sleep(1500)
  }

  const done = await page.evaluate(`
    const rows = [...document.querySelectorAll('#feed > *')].slice(${before})
    const asks = [...document.querySelectorAll('.ask')].map(a => a.innerText.replace(/\\s+/g, ' ').trim())
    return { rows: rows.map(r => r.innerText.replace(/\\s+/g, ' ').trim()), asks }
  `)
  console.log(`\nWhat the room saw while you were away (${done.rows.length} entries):`)
  for (const r of done.rows) console.log('  ' + r)
  if (done.asks.length) {
    console.log(`\nWaiting on a person (${done.asks.length}):`)
    for (const a of done.asks) console.log('  ' + a)
    console.log('\nNothing in that list has happened. It will not until somebody in the room approves it.')
  } else {
    console.log('\nNothing is waiting on a person.')
  }
}

const child = await ensureChrome()
const page = await openRoom()
log(`joined ${ROOM}`)
process.on('exit', () => { try { child?.kill() } catch { /* already gone */ } })

if (process.argv.includes('--selftest')) {
  await selftest(page)
  await page.close()
  process.exit(0)
}
const awayAt = process.argv.indexOf('--away')
if (awayAt >= 0) {
  const task = process.argv[awayAt + 1]
  if (!task) { log('--away needs a task in quotes'); process.exit(2) }
  await away(page, task)
  await page.close()
  process.exit(0)
}
await serve(page)
