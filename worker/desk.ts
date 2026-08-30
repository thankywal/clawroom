// Every member's own computer.
//
// A member's agent gets a real machine the moment it walks into a room: a
// Linux sandbox with a shell and a filesystem, one per person per room. The
// room never sees inside it. Commands, output and files are work tier, which
// means the log gets "ran a command, exit 0, 12 lines" and nothing else, the
// same way it gets "drafted variant 2" and not the draft.
//
// The Worker is a pass-through. It checks that the caller holds a key to the
// room, addresses the sandbox, and returns the result to the browser that
// asked. It does not store output, does not log it, and cannot be asked for
// it later, because there is no endpoint that reads a sandbox it was not
// handed the desk secret for. That secret is minted in the member's browser
// and lives in their scratch, which is the same boundary every other private
// thing in this product sits behind.
//
// Sandboxes sleep after ten idle minutes and wake on the next call, with the
// filesystem intact. That is what makes a computer per agent affordable.

import { getSandbox, type Sandbox } from '@cloudflare/sandbox'
import puppeteer from '@cloudflare/puppeteer'

// wrangler types does not know how to type a Durable Object class that lives
// in a dependency, so the binding is declared here and merged into Env.
declare global {
  interface Env {
    Sandbox: DurableObjectNamespace<Sandbox>
    BROWSER: Fetcher
  }
}

const WORKSPACE = '/workspace'
const EXEC_TIMEOUT_MS = 20_000
const MAX_OUTPUT = 8_000
const MAX_FILE = 64_000
const MAX_READ = 16_000
// A cold container can take a while to come up, and the browser has no way to
// tell a slow start from a dead one. Give every operation one budget, and
// answer honestly when it runs out.
const BUDGET_MS = 45_000

function withBudget<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('still starting')), BUDGET_MS)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

interface DeskRequest {
  k?: string
  desk?: string
  op?: 'exec' | 'write' | 'read' | 'ls' | 'destroy' | 'start' | 'procs' | 'kill' | 'fetch_local' | 'browse' | 'snapshot' | 'snapshots' | 'restore'
  cmd?: string
  path?: string
  content?: string
  port?: number
  id?: string
  url?: string
  name?: string
}

const BROWSE_MS = 25_000
const MAX_BROWSE = 12_000
const SNAPDIR = '/snapshots'

/** A page rendered by a real browser, reduced to the text a person would read.
 *  Work tier like everything else here: the URL and the text go back to the
 *  member's browser, and the room learns that a page was read. */
async function browse(env: Env, url: string): Promise<{ title: string; text: string; status: number }> {
  const browser = await puppeteer.launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSE_MS })
    const title = await page.title()
    const text = String(await page.evaluate("(document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n')"))
    return { title, text: clip(text, MAX_BROWSE), status: res?.status() ?? 0 }
  } finally {
    await browser.close()
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Paths are confined to the workspace. A stranger's agent will try `..`. */
function safePath(raw: unknown): string | null {
  const p = String(raw ?? '').trim()
  if (!p) return null
  const joined = p.startsWith('/') ? p : `${WORKSPACE}/${p}`
  const parts: string[] = []
  for (const seg of joined.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue }
    parts.push(seg)
  }
  const out = '/' + parts.join('/')
  return out === WORKSPACE || out.startsWith(WORKSPACE + '/') ? out : null
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `\n[clipped at ${n} characters]` : s)

export async function handleDesk(req: Request, env: Env, roomId: string): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: DeskRequest
  try { body = await req.json() as DeskRequest } catch { return json({ error: 'bad json' }, 400) }

  // Anyone with a key to the room may have a desk in it. The room decides
  // what the key is worth; this handler only asks whether it is worth anything.
  const desk = String(body.desk ?? '')
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(desk)) return json({ error: 'bad desk id' }, 400)

  // One call does both: proves the caller holds a key to this room, and
  // registers the desk against the room's cap. A room that will mint machines
  // for anyone who asks is a bill waiting to happen.
  const reg = await env.ROOM.get(env.ROOM.idFromName(roomId)).fetch(new Request(
    `https://room/desk?k=${encodeURIComponent(body.k ?? '')}&desk=${encodeURIComponent(desk)}`,
    { method: 'POST' },
  ))
  if (!reg.ok) {
    const why = await reg.json().catch(() => ({ error: 'not your room' })) as { error?: string }
    return json({ error: why.error ?? 'not your room' }, reg.status === 429 ? 429 : 403)
  }

  const sandbox = getSandbox(env.Sandbox, `desk:${roomId}:${desk}`, { sleepAfter: '10m' })

  try {
    switch (body.op) {
      case 'exec': {
        const cmd = String(body.cmd ?? '').trim()
        if (!cmd) return json({ error: 'no command' }, 400)
        await withBudget(sandbox.mkdir(WORKSPACE, { recursive: true }))
        const r = await withBudget(sandbox.exec(cmd, { cwd: WORKSPACE, timeout: EXEC_TIMEOUT_MS }))
        return json({
          ok: true, exitCode: r.exitCode, duration: r.duration,
          stdout: clip(r.stdout, MAX_OUTPUT), stderr: clip(r.stderr, MAX_OUTPUT),
        })
      }
      case 'write': {
        const path = safePath(body.path)
        if (!path) return json({ error: 'path must stay inside /workspace' }, 400)
        const content = String(body.content ?? '')
        if (content.length > MAX_FILE) return json({ error: `file over ${MAX_FILE} characters` }, 413)
        await withBudget(sandbox.mkdir(path.slice(0, path.lastIndexOf('/')) || WORKSPACE, { recursive: true }))
        await withBudget(sandbox.writeFile(path, content))
        return json({ ok: true, path, bytes: content.length })
      }
      case 'read': {
        const path = safePath(body.path)
        if (!path) return json({ error: 'path must stay inside /workspace' }, 400)
        const r = await withBudget(sandbox.readFile(path))
        return json({ ok: true, path, content: clip(r.content, MAX_READ) })
      }
      case 'ls': {
        const path = safePath(body.path ?? WORKSPACE) ?? WORKSPACE
        await withBudget(sandbox.mkdir(WORKSPACE, { recursive: true }))
        const r = await withBudget(sandbox.listFiles(path))
        return json({
          ok: true, path,
          files: r.files.map(f => ({ name: f.relativePath || f.name, type: f.type, size: f.size })),
        })
      }
      case 'destroy': {
        await withBudget(sandbox.destroy())
        return json({ ok: true })
      }

      // --- background processes, for anything that serves ---
      case 'start': {
        const cmd = String(body.cmd ?? '').trim()
        if (!cmd) return json({ error: 'no command' }, 400)
        await withBudget(sandbox.mkdir(WORKSPACE, { recursive: true }))
        const proc = await withBudget(sandbox.startProcess(cmd, { cwd: WORKSPACE }))
        if (body.port) {
          try { await withBudget(proc.waitForPort(Number(body.port), { mode: 'tcp' })) }
          catch { return json({ ok: true, id: proc.id, pid: proc.pid, port: body.port, listening: false }) }
        }
        return json({ ok: true, id: proc.id, pid: proc.pid, port: body.port ?? null, listening: Boolean(body.port) })
      }
      case 'procs': {
        const list = await withBudget(sandbox.listProcesses())
        return json({ ok: true, procs: list.map(p => ({ id: p.id, pid: p.pid, command: p.command, status: p.status })) })
      }
      case 'kill': {
        const id = String(body.id ?? '')
        if (!id) return json({ error: 'no process id' }, 400)
        await withBudget(sandbox.killProcess(id))
        return json({ ok: true })
      }
      // What a local server is showing, fetched from inside the machine. The
      // member's browser gets it; a share-tier tool decides whether the room does.
      case 'fetch_local': {
        const port = Number(body.port)
        if (!port || port < 1 || port > 65535) return json({ error: 'bad port' }, 400)
        const path = String(body.path ?? '/').replace(/[^A-Za-z0-9_./?=&%-]/g, '')
        const r = await withBudget(sandbox.exec(`curl -s -m 10 -w '\\n%{http_code}' http://127.0.0.1:${port}${path}`, { timeout: 15_000 }))
        const out = r.stdout ?? ''
        const cut = out.lastIndexOf('\n')
        return json({ ok: true, status: Number(out.slice(cut + 1)) || 0, body: clip(out.slice(0, cut), MAX_READ) })
      }

      // --- a browser, for reading the web ---
      case 'browse': {
        const url = String(body.url ?? '').trim()
        if (!/^https?:\/\//.test(url)) return json({ error: 'http(s) URLs only' }, 400)
        const page = await browse(env, url)
        return json({ ok: true, url, ...page })
      }

      // --- snapshots of the workspace, inside the machine ---
      case 'snapshot': {
        const name = String(body.name ?? new Date().toISOString().replace(/[:.]/g, '-')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'snap'
        await withBudget(sandbox.mkdir(SNAPDIR, { recursive: true }))
        await withBudget(sandbox.mkdir(WORKSPACE, { recursive: true }))
        const r = await withBudget(sandbox.exec(`tar -czf ${SNAPDIR}/${name}.tgz -C ${WORKSPACE} . && du -k ${SNAPDIR}/${name}.tgz | cut -f1`, { timeout: 15_000 }))
        return json({ ok: r.exitCode === 0, name, kb: Number(r.stdout.trim()) || 0, error: r.exitCode === 0 ? undefined : r.stderr })
      }
      case 'snapshots': {
        await withBudget(sandbox.mkdir(SNAPDIR, { recursive: true }))
        const r = await withBudget(sandbox.exec(`ls -1 ${SNAPDIR} 2>/dev/null | sed 's/\\.tgz$//'`, { timeout: 10_000 }))
        return json({ ok: true, snapshots: r.stdout.split('\n').map(s => s.trim()).filter(Boolean) })
      }
      case 'restore': {
        const name = String(body.name ?? '').replace(/[^A-Za-z0-9_-]/g, '')
        if (!name) return json({ error: 'which snapshot?' }, 400)
        const r = await withBudget(sandbox.exec(`test -f ${SNAPDIR}/${name}.tgz && rm -rf ${WORKSPACE}/* ${WORKSPACE}/.[!.]* 2>/dev/null; tar -xzf ${SNAPDIR}/${name}.tgz -C ${WORKSPACE}`, { timeout: 15_000 }))
        return json({ ok: r.exitCode === 0, name, error: r.exitCode === 0 ? undefined : (r.stderr || 'no such snapshot') })
      }
      default:
        return json({ error: 'unknown op' }, 400)
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    // The first request after a deploy, or after a long sleep, can land while
    // the container is still coming up. Say so rather than looking broken.
    const warming = /unavailable|not ready|starting|timed? ?out|ECONN/i.test(msg)
    return json({ error: warming ? 'Your computer is still starting up. Try again in a few seconds.' : msg }, warming ? 503 : 500)
  }
}
