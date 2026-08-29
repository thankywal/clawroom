// The tool calling loop, running in the page.
//
// The loop lives here rather than in the Worker for one reason that matters:
// tools are executed through document.modelContext.executeTool, so this is a
// WebMCP agent rather than a chatbot with a switch statement behind it. The
// Worker is a stateless one shot completion proxy and nothing more.
//
// Tool schemas come from the room definition, not from getTools(), because
// getTools() returns names and descriptions with no inputSchema. The handle it
// does return is what executeTool needs, so both are used, each for the half
// it can actually provide.

import type { ModelContext } from '../webmcp.js'
import type { Person, RoomDefinition, RoomTool } from '../types.js'
import type { ToolHost } from '../engine/webmcp.js'
import { COMMIT_NOTE } from '../engine/tiers.js'
import { builtinMemberTools, builtinStewardTools } from '../engine/builtins.js'
import type { RoomStore } from '../engine/store.js'
import { askModel, type AgentMsg, type AgentToolSpec, type ToolCall } from './protocol.js'

const MAX_TURNS = 6
const MAX_CALLS = 12
const MAX_RESULT = 4000
const KEEP_MESSAGES = 24

export interface AgentEvents {
  onAssistant?: (text: string) => void
  onToolCall?: (c: ToolCall) => void
  onToolResult?: (r: { name: string; text: string; ok: boolean }) => void
  onDone?: (reason: 'stop' | 'limit' | 'error' | 'stopped', detail?: string) => void
}

export interface Agent {
  send(userText: string): Promise<void>
  stop(): void
  transcript(): AgentMsg[]
  reset(): void
  readonly busy: boolean
}

/** Two parses deep: the envelope arrives as a JSON string, and the payload the
 *  tool returned sits inside content[].text. */
export function unwrapText(raw: unknown): string {
  let env: any = raw
  if (typeof env === 'string') {
    try { env = JSON.parse(env) } catch { return String(raw) }
  }
  if (Array.isArray(env?.content)) return env.content.map((c: any) => c?.text ?? '').join('')
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

export function toolSpecs(def: RoomDefinition, store: RoomStore, isSteward: boolean): AgentToolSpec[] {
  const tools: RoomTool[] = isSteward
    ? [...def.stewardTools, ...builtinStewardTools()]
    : [...def.memberTools, ...builtinMemberTools(store)]
  return tools.map(t => ({
    name: t.name,
    description: t.tier === 'commit' ? t.description + COMMIT_NOTE : t.description,
    parameters: t.inputSchema,
  }))
}

export function systemPrompt(def: RoomDefinition, me: Person, isSteward: boolean): string {
  const role = isSteward ? def.stewardRole : def.memberRole
  return [
    `You are ${me.name}'s agent in a ClawRoom called "${def.title}". ${def.premise}`,
    `${me.name} is the ${role} here. The steward of this room is the ${def.stewardRole}.`,
    'Rules of this room:',
    '- Use the tools. Never say you did something unless a tool call actually did it.',
    '- Commit-tier tools do not take effect when you call them. They return a handle and wait',
    '  for a human. That is normal and not an error. Call them once and never retry.',
    `- Everything you do is written to a work log the ${def.stewardRole} reads.`,
    `  Your conversation with ${me.name} is not, and no tool can return it.`,
    `Do what ${me.name} asks, then report back in two sentences.`,
  ].join('\n')
}

export function createAgent(deps: {
  mc: ModelContext
  host: ToolHost
  specs: () => AgentToolSpec[]
  system: () => string
  events?: AgentEvents
}): Agent {
  const { mc, host, specs, system, events = {} } = deps
  let messages: AgentMsg[] = []
  let ac: AbortController | null = null
  let busy = false

  const trim = (): AgentMsg[] => [
    { role: 'system', content: system() },
    ...messages.slice(-KEEP_MESSAGES),
  ]

  async function runCall(c: ToolCall): Promise<void> {
    const handle = await host.handle(c.name)
    if (!handle) {
      const known = (await host.surface()).join(', ')
      messages.push({ role: 'tool', id: c.id, name: c.name, content: `ERROR no tool called ${c.name}. Available: ${known}` })
      return
    }
    events.onToolCall?.(c)
    let out: string
    try {
      out = unwrapText(await mc.executeTool(handle, JSON.stringify(c.args)))
    } catch (e) {
      out = `ERROR ${String((e as Error)?.message ?? e)}`
    }
    const clipped = out.slice(0, MAX_RESULT)
    messages.push({ role: 'tool', id: c.id, name: c.name, content: clipped })
    events.onToolResult?.({ name: c.name, text: clipped, ok: !clipped.startsWith('ERROR') })
  }

  return {
    get busy() { return busy },
    transcript: () => messages.slice(),
    reset() { messages = [] },
    stop() { ac?.abort() },

    async send(userText: string) {
      if (busy) return
      busy = true
      ac = new AbortController()
      messages.push({ role: 'user', content: userText })
      let calls = 0

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const reply = await askModel({ messages: trim(), tools: specs() }, ac.signal)

          if (ac.signal.aborted) return events.onDone?.('stopped')
          if (reply.stop === 'error') return events.onDone?.('error', reply.error)

          if (reply.text) {
            messages.push({ role: 'assistant', content: reply.text, ...(reply.calls.length ? { calls: reply.calls } : {}) })
            events.onAssistant?.(reply.text)
          } else if (reply.calls.length) {
            messages.push({ role: 'assistant', content: '', calls: reply.calls })
          }

          if (!reply.calls.length) return events.onDone?.('stop')

          for (const c of reply.calls) {
            if (++calls > MAX_CALLS) return events.onDone?.('limit', 'too many tool calls in one go')
            await runCall(c)
            if (ac.signal.aborted) return events.onDone?.('stopped')
          }
        }
        events.onDone?.('limit')
      } finally {
        busy = false
        ac = null
      }
    },
  }
}
