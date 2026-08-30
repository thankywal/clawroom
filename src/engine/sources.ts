// Tools the room borrowed, and the one way they get in.
//
// A room ships with its own tools. A source is the other way: point the room
// at an OpenAPI document or a remote MCP server and its operations become
// room tools, tiered by the same three rules as everything else. Reads are
// work tier, writes are share tier, and anything irreversible is commit tier
// and waits for a person.
//
// The rule that makes this safe to offer at all: adding a source is itself a
// commit-tier tool. An agent can propose one, and nothing registers until a
// human in the room clicks approve. The moment they do, the source lands in
// shared state, every browser in the room remounts, and everyone's
// document.modelContext surface changes at once. That last part is the whole
// reason this belongs in a WebMCP project rather than a plugin system: the
// tool surface is live, and a person decides when it changes.

import type { RoomTool, SourceTool, ToolSource, WorkItem } from '../types.js'
import type { RoomStore } from './store.js'
import { currentRoomKey } from './computer.js'

interface Inspected {
  kind?: ToolSource['kind']
  name?: string
  url?: string
  base?: string
  tools?: SourceTool[]
  note?: string
  error?: string
}

interface CallReply {
  ok?: boolean
  status?: number
  text?: string
  error?: string
}

async function post(store: RoomStore, body: Record<string, unknown>): Promise<any> {
  try {
    const res = await fetch(`/api/source/${encodeURIComponent(store.roomKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ k: currentRoomKey(), ...body }),
    })
    const data = await res.json() as Record<string, unknown>
    return res.ok ? data : { error: data['error'] ?? `the source endpoint answered ${res.status}` }
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) }
  }
}

/** Read a URL and work out what tools are behind it. No side effects. */
export async function inspectSource(store: RoomStore, url: string): Promise<Inspected> {
  return await post(store, { op: 'inspect', url }) as Inspected
}

/** A short, readable prefix. Cut on a word boundary rather than mid word, so
 *  an order desk becomes harbour_foods_order and not harbour_foods_orde. */
const slug = (s: string): string => {
  const words = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  let out = ''
  for (const w of words) {
    const next = out ? `${out}_${w}` : w
    if (next.length > 20) break
    out = next
  }
  return out || 'source'
}

/** Borrowed tool names are prefixed with the source, so the work log says
 *  where a call went without anyone having to look it up, and so a source can
 *  never quietly shadow one of the room's own tools. */
export function sourceToolName(source: ToolSource, tool: SourceTool): string {
  return `${slug(source.name)}_${tool.name}`.slice(0, 60)
}

export function makeSource(a: {
  parsed: Inspected
  addedBy: string
}): ToolSource | null {
  const p = a.parsed
  if (!p.kind || !p.url) return null
  return {
    id: `src_${slug(String(p.name ?? p.url))}_${Math.random().toString(36).slice(2, 8)}`,
    kind: p.kind,
    name: String(p.name ?? p.url),
    url: String(p.url),
    base: String(p.base ?? p.url),
    addedBy: a.addedBy,
    at: Date.now(),
    tools: p.tools ?? [],
    ...(p.note ? { note: p.note } : {}),
  }
}

/** Every borrowed tool in the room, as room tools. Rebuilt from shared state,
 *  so two browsers in the same room always register the same surface. */
export function sourceTools(store: RoomStore): RoomTool[] {
  const out: RoomTool[] = []
  for (const source of store.state.sources) {
    for (const t of source.tools) {
      const name = sourceToolName(source, t)
      out.push({
        name,
        // Prettified from the operation, not from the prefixed tool name, so a
        // picker reads "Refund order" under the source rather than
        // "Harbour foods order refund order".
        title: t.name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) + ` (${source.name})`,
        description: `${t.description} (from ${source.name}, added to this room by a person)`,
        tier: t.tier,
        ...(t.tier === 'work' ? { readOnly: true, untrusted: true } : { untrusted: true }),
        inputSchema: t.inputSchema,
        run: async (ctx, args) => {
          const line = t.remote ? `${source.name}.${t.remote}` : `${t.method} ${t.path}`
          // A commit-tier borrowed call describes itself and stops. The
          // approver's browser runs this same function again with approved
          // set, which is the only pass that reaches the network.
          if (t.tier === 'commit' && !ctx.approved) {
            return {
              text: `Would call ${line} with ${JSON.stringify(args)}. Nothing has been sent.`,
              summary: `call ${line}`,
            }
          }
          const reply = await post(store, {
            op: 'call',
            kind: source.kind,
            base: source.base,
            ...(t.remote ? { remote: t.remote } : {}),
            ...(t.method ? { method: t.method } : {}),
            ...(t.path ? { path: t.path } : {}),
            args,
          }) as CallReply
          if (reply.error) return { text: `That call failed: ${reply.error}`, summary: `called ${line} and it failed` }

          const text = reply.text ?? ''
          if (t.tier !== 'work') {
            const item: WorkItem = {
              id: `${name}_${ctx.room.items.length + 1}`,
              title: line,
              state: reply.ok ? 'done' : 'blocked',
              owner: ctx.me.id,
              body: { brief: `HTTP ${reply.status}`, channel: source.name, args, result: text.slice(0, 2000) },
            }
            ctx.put(item)
          }
          return {
            text: `HTTP ${reply.status}\n${text}`,
            data: { status: reply.status, source: source.name },
            summary: `called ${line} (HTTP ${reply.status})`,
          }
        },
      })
    }
  }
  return out
}

/** The tools that manage sources. Present in every room, for everyone. */
export function sourceAdminTools(store: RoomStore): RoomTool[] {
  return [
    {
      name: 'list_tool_sources',
      title: 'Where this room borrowed tools',
      description:
        'List the places this room has borrowed tools from, and how many tools each one brought.',
      tier: 'work',
      readOnly: true,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: (ctx) => {
        const list = ctx.room.sources
        return {
          text: list.length
            ? list.map(s => `${s.name} (${s.kind}): ${s.tools.length} tools${s.note ? `, note: ${s.note}` : ''}`).join('\n')
            : 'This room has not borrowed any tools.',
          data: { sources: list.map(s => ({ id: s.id, name: s.name, kind: s.kind, tools: s.tools.length })) },
          summary: `listed ${list.length} tool sources`,
        }
      },
    },
    {
      name: 'add_tool_source',
      title: 'Propose tools from an API',
      description:
        'Propose that this room borrow the tools behind a URL: an OpenAPI document, or a remote ' +
        'MCP server. Nothing is registered by this call. A person in this room has to approve it, ' +
        'and when they do, everyone in the room gets the tools at the same time.',
      tier: 'commit',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'An https URL to an OpenAPI document or an MCP server' },
        },
        required: ['url'],
      },
      run: async (ctx, args) => {
        const url = String(args['url'] ?? '').trim()
        const parsed = await inspectSource(store, url)
        if (parsed.error) {
          return {
            text: `Nothing usable at that address: ${parsed.error}`,
            summary: `add tools from ${url}, which could not be read`,
          }
        }
        const tools = parsed.tools ?? []
        const waits = tools.filter(t => t.tier === 'commit').length
        const shape =
          `${tools.length} tools from ${parsed.name} (${parsed.kind})` +
          (waits ? `, ${waits} of which will wait for a person each time` : '')

        if (!ctx.approved) {
          return {
            text:
              `Found ${shape}.\n` +
              tools.slice(0, 12).map(t => `  ${t.tier.padEnd(6)} ${t.name}`).join('\n') +
              (tools.length > 12 ? `\n  and ${tools.length - 12} more` : '') +
              (parsed.note ? `\n${parsed.note}` : ''),
            summary: `add ${shape}`,
          }
        }

        const source = makeSource({ parsed, addedBy: ctx.me.id })
        if (!source) return { text: 'That source could not be built.', summary: `failed to add ${url}` }
        store.dispatch({ k: 'source', source })
        return {
          text: `Added ${shape}. Everyone in this room has them now.`,
          summary: `added ${shape}`,
        }
      },
    },
  ]
}

/** Human actions, not tool calls. The steward is a person clicking a button,
 *  so these dispatch straight rather than going through the tier engine. */
export function addSourceAsHuman(store: RoomStore, parsed: Inspected, by: string): ToolSource | null {
  const source = makeSource({ parsed, addedBy: by })
  if (!source) return null
  store.dispatch({ k: 'source', source })
  return source
}

export function removeSource(store: RoomStore, sourceId: string): void {
  store.dispatch({ k: 'unsource', sourceId })
}

/** The names a room currently registers because of its sources. Used to spot
 *  when the surface has to be rebuilt. */
export function sourceFingerprint(ctx: { sources: ToolSource[] }): string {
  return ctx.sources.map(s => `${s.id}:${s.tools.length}`).join('|')
}
