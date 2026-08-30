// Mounting and unmounting a room's tool surface.
//
// There is no unregisterTool() in the API. Removal only happens by aborting
// the signal the tools were registered under, which makes that AbortController
// the thing room switching is built on.
//
// Abort is confirmed to remove tools on Chrome 151, but nothing says removal
// is synchronous, and re-registering into a half torn down surface would be a
// quiet and miserable bug. So unmount waits for the old names to actually go.

import type { ModelContext, RegisteredTool, ToolDefinition } from '../webmcp.js'
import type { Person, RoomDefinition, RoomTool, Tier, ToolOutcome } from '../types.js'
import type { RoomStore } from './store.js'
import { builtinMemberTools, builtinStewardTools } from './builtins.js'
import { COMMIT_NOTE, runRoomTool } from './tiers.js'

export function resolveModelContext(): ModelContext | null {
  return document.modelContext ?? navigator.modelContext ?? null
}

export function namespaceName(): 'document' | 'navigator' | null {
  if (document.modelContext) return 'document'
  if (navigator.modelContext) return 'navigator'
  return null
}

export interface CallReport {
  name: string
  tier: Tier
  outcome: ToolOutcome
}

export interface ToolHost {
  mount(def: RoomDefinition, o: { store: RoomStore; me: Person; isSteward: boolean }): Promise<string[]>
  unmount(): Promise<void>
  handle(name: string): Promise<RegisteredTool | null>
  surface(): Promise<string[]>
  readonly available: boolean
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** name_like_this -> Name like this. Every tool gets a readable title, because
 *  a picker showing bare snake_case is a picker nobody can read. */
function prettify(name: string): string {
  const words = name.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

interface Mounted { ac: AbortController; sig: string }

export function createToolHost(o: { onCall?: (r: CallReport) => void } = {}): ToolHost {
  const mc = resolveModelContext()
  // One AbortController per tool rather than one for the surface. Approving a
  // source used to tear the whole surface down and rebuild it, which left a
  // window where getTools() returned nothing at all: exactly the wrong thing
  // for the one feature whose point is that the surface changes live. Now four
  // new tools mean four registrations and nothing else moves.
  const mounted = new Map<string, Mounted>()
  let lastStore: RoomStore | null = null

  const names = async (): Promise<string[]> => {
    if (!mc) return []
    try { return (await mc.getTools()).map(t => t.name) } catch { return [] }
  }

  /** Abort is confirmed to remove tools on Chrome 151, but nothing says it is
   *  synchronous, and registering a name back into a half torn down surface
   *  would be a quiet and miserable bug. So wait for the names to go. */
  const settle = async (going: Set<string>): Promise<void> => {
    for (let i = 0; i < 25; i++) {
      const live = await names()
      if (!live.some(n => going.has(n))) return
      await sleep(20)
    }
  }

  const toWebMcp = (
    tool: RoomTool,
    store: RoomStore,
    me: Person,
    isSteward: boolean,
  ): ToolDefinition => ({
    name: tool.name,
    title: tool.title ?? prettify(tool.name),
    description: tool.tier === 'commit' ? tool.description + COMMIT_NOTE : tool.description,
    inputSchema: tool.inputSchema,
    // Always sent, both of them. Leaving the object off for a tool that
    // happens not to set readOnly told a model nothing about computer_run or
    // publish, which are the two it most needs to be careful with. An absent
    // hint is not a safe default; it is a missing one.
    annotations: {
      readOnlyHint: tool.readOnly ?? false,
      untrustedContentHint: tool.untrusted ?? false,
    },
    execute: async (args: Record<string, unknown>) => {
      const outcome = await runRoomTool({ store, tool, me, isSteward, args: args ?? {} })
      o.onCall?.({ name: tool.name, tier: tool.tier, outcome })
      return {
        content: [{ type: 'text' as const, text: outcome.text }],
        ...(outcome.data !== undefined ? { structuredContent: outcome.data } : {}),
      }
    },
  })

  const host: ToolHost = {
    available: mc !== null,

    async mount(def, { store, me, isSteward }) {
      if (!mc) return []

      const tools = isSteward
        ? [...def.stewardTools, ...builtinStewardTools(store)]
        : [...def.memberTools, ...builtinMemberTools(store)]

      const names = tools.map(t => t.name)
      const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
      if (dupes.length) throw new Error(`Duplicate tool names in room ${def.id}: ${dupes.join(', ')}`)

      // A tool is the same tool if nothing a caller can see has changed and
      // the closure it carries still points at the same room. The store is in
      // the signature because every run() closes over it, so a store swap has
      // to re-register even when the description is identical.
      if (lastStore !== store) {
        await host.unmount()
        lastStore = store
      }
      const signature = (t: RoomTool): string =>
        `${t.tier}|${t.title ?? ''}|${t.description}|${JSON.stringify(t.inputSchema)}|${t.readOnly}|${t.untrusted}|${me.id}|${isSteward}`

      const wanted = new Map(tools.map(t => [t.name, t]))
      const dying: string[] = []
      for (const [name, m] of [...mounted]) {
        const t = wanted.get(name)
        if (t && signature(t) === m.sig) continue
        m.ac.abort()
        mounted.delete(name)
        dying.push(name)
      }
      if (dying.length) await settle(new Set(dying))

      for (const [name, tool] of wanted) {
        if (mounted.has(name)) continue
        const ac = new AbortController()
        await mc.registerTool(toWebMcp(tool, store, me, isSteward), { signal: ac.signal })
        mounted.set(name, { ac, sig: signature(tool) })
      }
      return [...mounted.keys()]
    },

    async unmount() {
      if (!mounted.size) return
      const going = new Set(mounted.keys())
      for (const m of mounted.values()) m.ac.abort()
      mounted.clear()
      lastStore = null
      await settle(going)
    },

    async handle(name) {
      if (!mc) return null
      try {
        return (await mc.getTools()).find(t => t.name === name) ?? null
      } catch {
        return null
      }
    },

    surface: names,
  }

  return host
}
