// The tools that drive a member's own computer, offered in every room.
//
// These are work tier on purpose and all the way down. The command, its
// output and every file stay on the member's machine. What the room learns
// is the shape of the work: a command ran and exited zero, a file of some
// size was written. That is the same promise the rest of the engine makes
// about drafts and hints, extended to a filesystem and a shell.
//
// The one deliberate exception is computer_share_file, which is share tier
// and says so in its description, because the moment a file lands on the
// board is the moment it stops being private, and the agent should choose
// that moment knowingly.

import type { RoomTool, ToolContext, WorkItem } from '../types.js'
import type { RoomStore } from './store.js'

const SECRET_KEY = 'computer:secret'
const RUNS_KEY = 'computer:runs'
const WRITES_KEY = 'computer:writes'

interface DeskReply {
  ok?: boolean
  error?: string
  id?: string
  pid?: number
  port?: number | null
  listening?: boolean
  procs?: { id: string; pid?: number; command: string; status: string }[]
  status?: number
  body?: string
  title?: string
  text?: string
  url?: string
  name?: string
  kb?: number
  snapshots?: string[]
  exitCode?: number
  stdout?: string
  stderr?: string
  path?: string
  bytes?: number
  content?: string
  files?: { name: string; type: string; size: number }[]
}

let keyOverride: string | null = null

/** Pages that are not a room, like the self-test, mint a real room and hand
 *  its member key here, because a computer only exists inside a room. */
export function setComputerAccess(a: { key: string }): void {
  keyOverride = a.key
}

function roomKeyFromUrl(): string {
  return keyOverride ?? new URLSearchParams(location.search).get('k') ?? ''
}

/** Minted once per member per room, in the browser, and never sent anywhere
 *  except as the address of that member's own sandbox. */
function deskSecret(ctx: ToolContext): string {
  const have = ctx.scratch.get(SECRET_KEY)
  if (typeof have === 'string' && have.length >= 16) return have
  const fresh = crypto.randomUUID().replace(/-/g, '')
  ctx.scratch.set(SECRET_KEY, fresh)
  return fresh
}

async function desk(store: RoomStore, ctx: ToolContext, body: Record<string, unknown>): Promise<DeskReply> {
  try {
    const res = await fetch(`/api/desk/${encodeURIComponent(store.roomKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ k: roomKeyFromUrl(), desk: deskSecret(ctx), ...body }),
    })
    const data = await res.json() as DeskReply
    return res.ok ? data : { error: data.error ?? `computer returned ${res.status}` }
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) }
  }
}

const bump = (ctx: ToolContext, key: string) => {
  const n = Number(ctx.scratch.get(key) ?? 0)
  ctx.scratch.set(key, n + 1)
}

const lines = (s: string) => (s.trim() ? s.trim().split('\n').length : 0)

/** Tears down this member's sandbox in this room. Only this browser can,
 *  because only this browser holds the desk secret. Called by the same button
 *  that wipes drafts, since both are "everything the room never had". */
export async function destroyComputer(store: RoomStore, scratch: ToolContext['scratch']): Promise<void> {
  const have = scratch.get(SECRET_KEY)
  if (typeof have !== 'string') return
  try {
    await fetch(`/api/desk/${encodeURIComponent(store.roomKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ k: roomKeyFromUrl(), desk: have, op: 'destroy' }),
    })
  } catch { /* a sandbox that is already gone is the outcome wanted */ }
}

export function computerCounters(scratch: ToolContext['scratch']): { runs: number; writes: number } {
  return { runs: Number(scratch.get(RUNS_KEY) ?? 0), writes: Number(scratch.get(WRITES_KEY) ?? 0) }
}

export function computerTools(store: RoomStore): RoomTool[] {
  return [
    {
      name: 'computer_run',
      description:
        'Run a shell command on your own computer, a Linux machine that is yours for this ' +
        'room. Python and Node are installed. Files live under /workspace and persist. ' +
        'Nobody else in the room sees the command or its output, only that you ran something ' +
        'and whether it succeeded.',
      tier: 'work',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The shell command to run' } },
        required: ['command'],
      },
      run: async (ctx, args) => {
        const command = String(args['command'] ?? '')
        const r = await desk(store, ctx, { op: 'exec', cmd: command })
        if (r.error) return { text: `Could not run that: ${r.error}` }
        bump(ctx, RUNS_KEY)
        const out = [r.stdout ?? '', r.stderr ? `stderr:\n${r.stderr}` : ''].filter(Boolean).join('\n')
        return {
          text: `exit ${r.exitCode}\n${out || '(no output)'}`,
          data: { exitCode: r.exitCode },
          summary: `ran \`${command.slice(0, 48)}${command.length > 48 ? '…' : ''}\` (exit ${r.exitCode}, ${lines(r.stdout ?? '')} lines out)`,
        }
      },
    },
    {
      name: 'computer_write_file',
      description:
        'Write a file on your own computer, under /workspace. Stays there. The room is told ' +
        'the file name and size, never the contents.',
      tier: 'work',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'For example notes.md or src/app.py' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      run: async (ctx, args) => {
        const r = await desk(store, ctx, { op: 'write', path: args['path'], content: String(args['content'] ?? '') })
        if (r.error) return { text: `Could not write that: ${r.error}` }
        bump(ctx, WRITES_KEY)
        return { text: `Wrote ${r.path} (${r.bytes} bytes). It is on your computer only.`, summary: `wrote ${r.path} (${r.bytes} bytes)` }
      },
    },
    {
      name: 'computer_read_file',
      description: 'Read a file from your own computer. The room is told that you read it, not what it said.',
      tier: 'work',
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      run: async (ctx, args) => {
        const r = await desk(store, ctx, { op: 'read', path: args['path'] })
        if (r.error) return { text: `Could not read that: ${r.error}` }
        return { text: r.content ?? '', summary: `read ${r.path}` }
      },
    },
    {
      name: 'computer_list_files',
      description: 'List the files on your own computer under /workspace, or under a path you give.',
      tier: 'work',
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Defaults to /workspace' } },
      },
      run: async (ctx, args) => {
        const r = await desk(store, ctx, { op: 'ls', path: args['path'] ?? '/workspace' })
        if (r.error) return { text: `Could not list that: ${r.error}` }
        const files = r.files ?? []
        return {
          text: files.length ? files.map(f => `${f.type === 'directory' ? 'd' : 'f'} ${f.name} ${f.size}`).join('\n') : 'Nothing there yet.',
          data: { files },
          summary: `listed ${r.path} (${files.length} entries)`,
        }
      },
    },
    {
      name: 'computer_serve',
      description:
        'Start a long-running program on your own computer, for example a web server, and keep it ' +
        'running in the background. Give the port it will listen on and the tool waits for it to come ' +
        'up. Nothing it serves is visible to the room until you computer_share_page it.',
      tier: 'work',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'For example: python3 -m http.server 8000' },
          port: { type: 'number', description: 'The port it will listen on' },
        },
        required: ['command', 'port'],
      },
      run: async (ctx, args) => {
        const command = String(args['command'] ?? '')
        const r = await desk(store, ctx, { op: 'start', cmd: command, port: Number(args['port']) })
        if (r.error) return { text: `Could not start that: ${r.error}` }
        bump(ctx, RUNS_KEY)
        return {
          text: r.listening
            ? `Running as process ${r.id} and listening on port ${r.port}. Use computer_fetch_local to see what it serves, computer_share_page to show the room.`
            : `Started as process ${r.id} but nothing is listening on port ${r.port} yet. Check it with computer_processes, or computer_run a curl against it.`,
          data: { id: r.id, port: r.port, listening: r.listening },
          summary: `started \`${command.slice(0, 40)}\` on port ${r.port} (${r.listening ? 'listening' : 'not yet listening'})`,
        }
      },
    },
    {
      name: 'computer_processes',
      description: 'List the programs running in the background on your own computer, and stop one by id.',
      tier: 'work',
      inputSchema: {
        type: 'object',
        properties: { kill: { type: 'string', description: 'A process id to stop. Omit to just list.' } },
      },
      run: async (ctx, args) => {
        if (args['kill']) {
          const k = await desk(store, ctx, { op: 'kill', id: String(args['kill']) })
          if (k.error) return { text: `Could not stop that: ${k.error}` }
          return { text: `Stopped ${String(args['kill'])}.`, summary: `stopped a background process` }
        }
        const r = await desk(store, ctx, { op: 'procs' })
        if (r.error) return { text: `Could not list: ${r.error}` }
        const procs = r.procs ?? []
        return {
          text: procs.length ? procs.map(p => `${p.id}  ${p.status}  ${p.command}`).join('\n') : 'Nothing running in the background.',
          data: { procs },
          summary: `listed ${procs.length} background process${procs.length === 1 ? '' : 'es'}`,
        }
      },
    },
    {
      name: 'computer_fetch_local',
      description:
        'Fetch a page from a server running on your own computer, by port and path. You see the ' +
        'response; the room only learns that you checked.',
      tier: 'work',
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: { port: { type: 'number' }, path: { type: 'string', description: 'Defaults to /' } },
        required: ['port'],
      },
      run: async (ctx, args) => {
        const r = await desk(store, ctx, { op: 'fetch_local', port: Number(args['port']), path: String(args['path'] ?? '/') })
        if (r.error) return { text: `Could not fetch that: ${r.error}` }
        return { text: `HTTP ${r.status}\n${r.body ?? ''}`, data: { status: r.status }, summary: `checked port ${Number(args['port'])} (HTTP ${r.status})` }
      },
    },
    {
      name: 'computer_share_page',
      description:
        'Put what a server on your computer is showing onto the shared board, so everyone in the room ' +
        'can see the page. This is the moment it stops being private, so share only what you mean.',
      tier: 'share',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number' },
          path: { type: 'string', description: 'Defaults to /' },
          title: { type: 'string', description: 'What to call it on the board' },
        },
        required: ['port'],
      },
      run: async (ctx, args) => {
        const port = Number(args['port'])
        const r = await desk(store, ctx, { op: 'fetch_local', port, path: String(args['path'] ?? '/') })
        if (r.error) return { text: `Could not share that: ${r.error}` }
        const html = r.body ?? ''
        const title = String(args['title'] ?? `Page on port ${port}`)
        const item: WorkItem = {
          id: `page_${port}_${String(args['path'] ?? '/').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
          title,
          state: 'review',
          owner: ctx.me.id,
          body: { brief: `HTTP ${r.status}, ${html.length} characters`, channel: 'the board', port, path: String(args['path'] ?? '/'), html },
        }
        ctx.put(item)
        return { text: `Shared "${title}" to the board (${html.length} characters). Everyone in the room can read it now.`, summary: `shared a page from port ${port} to the board (${html.length} characters)` }
      },
    },
    {
      name: 'computer_browse',
      description:
        'Open a public web page in a real browser and read its text. You get the page; the room only ' +
        'learns that you read a page, not which one or what it said.',
      tier: 'work',
      readOnly: true,
      untrusted: true,
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'An http or https URL' } },
        required: ['url'],
      },
      run: async (ctx, args) => {
        const r = await desk(store, ctx, { op: 'browse', url: String(args['url'] ?? '') })
        if (r.error) return { text: `Could not open that: ${r.error}` }
        return {
          text: `${r.title ?? ''} (HTTP ${r.status})\n\n${r.text ?? ''}`,
          data: { url: r.url, status: r.status, title: r.title },
          summary: `read a web page (HTTP ${r.status}, ${(r.text ?? '').length} characters)`,
        }
      },
    },
    {
      name: 'computer_snapshot',
      description:
        'Save a snapshot of everything under /workspace on your own computer, so you can get back to ' +
        'it later with computer_restore. Stays on your computer.',
      tier: 'work',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'A name for it. Defaults to the time.' } },
      },
      run: async (ctx, args) => {
        const r = await desk(store, ctx, { op: 'snapshot', name: args['name'] })
        if (r.error || !r.ok) return { text: `Could not snapshot: ${r.error ?? 'unknown'}` }
        return { text: `Saved snapshot "${r.name}" (${r.kb} KB).`, data: { name: r.name }, summary: `saved a snapshot (${r.kb} KB)` }
      },
    },
    {
      name: 'computer_restore',
      description:
        'Put /workspace on your own computer back to a snapshot. Everything currently there is ' +
        'replaced. Call with no name to list the snapshots you have.',
      tier: 'work',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      run: async (ctx, args) => {
        if (!args['name']) {
          const l = await desk(store, ctx, { op: 'snapshots' })
          const names = l.snapshots ?? []
          return { text: names.length ? names.join('\n') : 'No snapshots yet.', data: { snapshots: names }, summary: `listed ${names.length} snapshots` }
        }
        const r = await desk(store, ctx, { op: 'restore', name: String(args['name']) })
        if (r.error || !r.ok) return { text: `Could not restore: ${r.error ?? 'unknown'}` }
        return { text: `Restored /workspace from "${r.name}".`, summary: `restored a snapshot` }
      },
    },
    {
      name: 'computer_share_file',
      description:
        'Put a file from your computer on the shared board, where everyone in the room can read ' +
        'it. This is the moment the file stops being private, so share only the one you mean.',
      tier: 'share',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          title: { type: 'string', description: 'What to call it on the board. Defaults to the file name.' },
        },
        required: ['path'],
      },
      run: async (ctx, args) => {
        const r = await desk(store, ctx, { op: 'read', path: args['path'] })
        if (r.error) return { text: `Could not share that: ${r.error}` }
        const path = r.path ?? String(args['path'])
        const name = path.slice(path.lastIndexOf('/') + 1)
        const content = r.content ?? ''
        const item: WorkItem = {
          id: `file_${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
          title: String(args['title'] ?? name),
          state: 'review',
          owner: ctx.me.id,
          body: { brief: content.split('\n')[0]?.slice(0, 80) ?? '', channel: 'the board', path, content },
        }
        ctx.put(item)
        return {
          text: `Shared ${path} to the board as "${item.title}". Everyone in the room can read it now.`,
          summary: `shared ${name} to the board (${content.length} characters)`,
        }
      },
    },
  ]
}
