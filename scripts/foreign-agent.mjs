/* An agent that has never seen this codebase drives a room.
 *
 * Everything the in-page agent knows about a room, it knows because it
 * imports the room definition. That is fine for a product and useless as
 * evidence, because a sceptic can say both halves are ours. This script is
 * the other half being somebody else's.
 *
 * It lives outside the browser, attaches over CDP, and learns the room the
 * only way WebMCP allows: getTools(). Name, description, inputSchema. It
 * imports nothing from src/. It does not know what a tier is, what a room is,
 * or that publish parks. It reads the descriptions like a stranger and calls
 * executeTool() like a stranger, and the room has to hold up.
 *
 * The model is reached through the same stateless proxy the page uses. The
 * proxy has no notion of rooms; it is handed exactly the tool list this
 * script built from getTools() and nothing else.
 *
 *   CDP_PORT=9343 node scripts/foreign-agent.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'https://clawroom.thankywal-bkk.workers.dev'
const PORT = process.env.CDP_PORT ?? 9343
const TASK = process.env.TASK ??
  'Draft two options for the launch announcement, submit the better one, then publish it.'
const MAX_TURNS = 8
const sleep = ms => new Promise(r => setTimeout(r, ms))

// --- a browser, and a page in it ------------------------------------------
async function attach() {
  let t
  for (let i = 0; i < 40 && !t; i++) {
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page') } catch {}
    if (!t) await sleep(250)
  }
  if (!t) throw new Error('no Chrome on ' + PORT)
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  let id = 0; const waiting = new Map()
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id) } }
  await new Promise(r => ws.onopen = r)
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const run = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
    return r.result?.result?.value
  }
  await send('Page.enable'); await send('Runtime.enable')
  return { send, run }
}

// --- discovery: the only thing this script is allowed to know --------------
async function discover(page) {
  const raw = await page.run(`(async () => {
    const mc = document.modelContext ?? navigator.modelContext
    if (!mc) return null
    const tools = await mc.getTools()
    return tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  })()`)
  if (!raw) throw new Error('this page exposes no modelContext')
  return raw.map(t => {
    // Chrome 151 hands inputSchema back as a stringified DOMString although
    // the spec has said object since webmcp#241. A foreign client has to cope.
    let schema = t.inputSchema
    if (typeof schema === 'string') { try { schema = JSON.parse(schema) } catch { schema = { type: 'object' } } }
    return { name: t.name, description: t.description, parameters: schema ?? { type: 'object' } }
  })
}

// --- execution: through the standard surface, by name ----------------------
async function call(page, name, args) {
  const out = await page.run(`(async () => {
    const mc = document.modelContext ?? navigator.modelContext
    const t = (await mc.getTools()).find(x => x.name === ${JSON.stringify(name)})
    if (!t) return 'ERROR no such tool'
    const raw = await mc.executeTool(t, ${JSON.stringify(JSON.stringify(args))})
    try { const env = typeof raw === 'string' ? JSON.parse(raw) : raw
          return Array.isArray(env?.content) ? env.content.map(c => c?.text ?? '').join('') : String(raw) }
    catch { return String(raw) }
  })()`)
  return String(out)
}

// --- the model, through the stateless proxy ---------------------------------
async function ask(messages, tools) {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, tools }),
  })
  if (!res.ok) return { text: '', calls: [], stop: 'error', error: `proxy ${res.status}` }
  return await res.json()
}

// --- go --------------------------------------------------------------------
const room = await (await fetch(`${BASE}/api/rooms`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ defId: 'campaign', title: 'Foreign agent' }),
})).json()

const page = await attach()
await page.send('Page.navigate', { url: `${BASE}/room.html?r=${room.roomId}&k=${room.member}&as=Visitor` })
for (let i = 0; i < 40; i++) {
  if (await page.run(`document.querySelectorAll('tbody tr').length > 0`)) break
  await sleep(500)
}

const tools = await discover(page)
console.log(`discovered ${tools.length} tools from getTools():`)
for (const t of tools) console.log(`  ${t.name.padEnd(22)} ${t.description.slice(0, 80)}`)

const SYSTEM =
  'You are an agent operating a web page through the tools it exposes. You know ' +
  'nothing about this page except the tools listed and their descriptions. Read the ' +
  'descriptions carefully and follow what they say. Use the tools to do what the user ' +
  'asks, then report back in two sentences. Never claim to have done something a tool ' +
  'did not do.'

const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: TASK }]
const transcript = { ran: new Date().toISOString(), room: room.roomId, task: TASK, tools, steps: [] }
let final = ''

let lastCall = ''
let repeats = 0
for (let turn = 0; turn < MAX_TURNS; turn++) {
  const reply = await ask(messages, tools)
  if (reply.stop === 'error') { console.log('model error:', reply.error); transcript.error = reply.error; break }
  if (reply.text) { messages.push({ role: 'assistant', content: reply.text, ...(reply.calls?.length ? { calls: reply.calls } : {}) }); final = reply.text }
  else if (reply.calls?.length) messages.push({ role: 'assistant', content: '', calls: reply.calls })
  if (!reply.calls?.length) break
  for (const c of reply.calls) {
    // Loop detection is an agent runtime's job, not the page's. A stranger
    // that polls the same read forever is a bad stranger, not a bad room.
    const sig = c.name + JSON.stringify(c.args ?? {})
    repeats = sig === lastCall ? repeats + 1 : 0
    lastCall = sig
    if (repeats >= 2) {
      messages.push({ role: 'user', content: 'That has not changed. Stop calling tools and report back now.' })
      break
    }
    const result = await call(page, c.name, c.args ?? {})
    console.log(`  -> ${c.name}(${JSON.stringify(c.args ?? {}).slice(0, 70)})`)
    console.log(`     ${result.slice(0, 110).replace(/\n/g, ' ')}`)
    transcript.steps.push({ tool: c.name, args: c.args ?? {}, result: result.slice(0, 600) })
    messages.push({ role: 'tool', id: c.id, name: c.name, content: result.slice(0, 4000) })
  }
}
transcript.final = final
console.log('\nagent:', final)

// Verification is separate from the agent. Read what a person in the room
// would read: the visible page, not the engine.
await sleep(800)
const seen = await page.run(`document.body.innerText`)
transcript.verify = {
  parkedForApproval: /waiting on your approval/i.test(seen),
  publishedWithoutHuman: /\bdone\b/.test(seen) && !/waiting on your approval/i.test(seen),
  logLines: (seen.match(/^Visitor\n(?:local|shared|commit|person)\n\S+/gm) ?? []).map(l => l.replace(/\n/g, ' ')),
}
console.log('\nverify:', JSON.stringify(transcript.verify, null, 1))

mkdirSync('docs/evidence', { recursive: true })
const file = `docs/evidence/foreign-agent-${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(file, JSON.stringify(transcript, null, 2) + '\n')
console.log('wrote', file)
process.exit(0)
