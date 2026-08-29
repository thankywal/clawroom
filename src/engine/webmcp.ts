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

export function createToolHost(o: { onCall?: (r: CallReport) => void } = {}): ToolHost {
  const mc = resolveModelContext()
  let ac: AbortController | null = null
  let mounted: string[] = []

  const names = async (): Promise<string[]> => {
    if (!mc) return []
    try { return (await mc.getTools()).map(t => t.name) } catch { return [] }
  }

  const toWebMcp = (
    tool: RoomTool,
    store: RoomStore,
    me: Person,
    isSteward: boolean,
  ): ToolDefinition => ({
    name: tool.name,
    description: tool.tier === 'commit' ? tool.description + COMMIT_NOTE : tool.description,
    inputSchema: tool.inputSchema,
    // exactOptionalPropertyTypes means an explicit undefined is a type error,
    // so build the annotations by spreading only what is actually set.
    ...(tool.readOnly !== undefined || tool.untrusted !== undefined
      ? {
          annotations: {
            ...(tool.readOnly !== undefined ? { readOnlyHint: tool.readOnly } : {}),
            ...(tool.untrusted !== undefined ? { untrustedContentHint: tool.untrusted } : {}),
          },
        }
      : {}),
    execute: async (args: Record<string, unknown>) => {
      const outcome = runRoomTool({ store, tool, me, isSteward, args: args ?? {} })
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
      await host.unmount()
      if (!mc) return []

      const tools = isSteward
        ? [...def.stewardTools, ...builtinStewardTools()]
        : [...def.memberTools, ...builtinMemberTools(store)]

      const wanted = tools.map(t => t.name)
      const dupes = [...new Set(wanted.filter((n, i) => wanted.indexOf(n) !== i))]
      if (dupes.length) throw new Error(`Duplicate tool names in room ${def.id}: ${dupes.join(', ')}`)

      ac = new AbortController()
      for (const tool of tools) {
        await mc.registerTool(toWebMcp(tool, store, me, isSteward), { signal: ac.signal })
      }
      mounted = wanted
      return wanted
    },

    async unmount() {
      if (!ac) return
      ac.abort()
      ac = null
      const going = new Set(mounted)
      mounted = []
      // Wait for the surface to settle rather than trusting abort to be sync.
      for (let i = 0; i < 25; i++) {
        const live = await names()
        if (!live.some(n => going.has(n))) return
        await sleep(20)
      }
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
