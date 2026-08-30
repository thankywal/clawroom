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
