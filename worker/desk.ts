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

// wrangler types does not know how to type a Durable Object class that lives
// in a dependency, so the binding is declared here and merged into Env.
declare global {
  interface Env {
    Sandbox: DurableObjectNamespace<Sandbox>
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
  op?: 'exec' | 'write' | 'read' | 'ls' | 'destroy'
  cmd?: string
  path?: string
  content?: string
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
  const meta = await env.ROOM.get(env.ROOM.idFromName(roomId))
    .fetch(new Request(`https://room/meta?k=${encodeURIComponent(body.k ?? '')}`))
  if (!meta.ok) return json({ error: 'not your room' }, 403)

  const desk = String(body.desk ?? '')
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(desk)) return json({ error: 'bad desk id' }, 400)

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
