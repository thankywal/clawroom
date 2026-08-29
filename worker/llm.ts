// One shape in, one shape out, so swapping providers touches this file only.
//
// Workers AI is the default because the account already has it, there is no
// key to leak, and the free allocation covers a demo. The OpenAI-compatible
// path is wired from the start rather than added under pressure: if a 70B
// model turns out to be erratic at multi-step tool calling, two secrets point
// this at a different provider with no code change.

export interface AgentToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export type AgentMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; calls?: ToolCall[] }
  | { role: 'tool'; id: string; name: string; content: string }

export interface AgentReply {
  text: string
  calls: ToolCall[]
  stop: 'stop' | 'tools' | 'error'
  error?: string
}

export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw)
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** Workers AI has no call ids, so synthesise them. That mismatch is most of
 *  the reason this normalisation layer exists. */
function normaliseCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return []
  return raw.map((c: any, i: number) => ({
    id: typeof c?.id === 'string' ? c.id : `c_${i}`,
    name: String(c?.name ?? c?.function?.name ?? ''),
    args: parseArgs(c?.arguments ?? c?.function?.arguments ?? c?.args),
  })).filter(c => c.name)
}

/** The wire format both providers understand. Tool results go back as a plain
 *  user turn, which every instruct model handles, rather than as a role that
 *  only some of them do. */
function toWire(messages: AgentMsg[]): Array<{ role: string; content: string }> {
  return messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'user', content: `Result of ${m.name}:\n${m.content}` }
    }
    if (m.role === 'assistant' && m.calls?.length) {
      const named = m.calls.map(c => `${c.name}(${JSON.stringify(c.args)})`).join(', ')
      return { role: 'assistant', content: m.content ? `${m.content}\n[called ${named}]` : `[called ${named}]` }
    }
    return { role: m.role, content: m.content }
  })
}

async function viaOpenAI(
  base: string, key: string, model: string,
  req: { messages: AgentMsg[]; tools: AgentToolSpec[] },
): Promise<AgentReply> {
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: toWire(req.messages),
      tools: req.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
      temperature: 0.2,
    }),
  })
  if (!res.ok) return { text: '', calls: [], stop: 'error', error: `provider ${res.status}` }
  const json = await res.json() as any
  const msg = json?.choices?.[0]?.message
  const calls = normaliseCalls(msg?.tool_calls)
  return {
    text: String(msg?.content ?? ''),
    calls,
    stop: calls.length ? 'tools' : 'stop',
  }
}

export async function complete(
  env: Env,
  req: { messages: AgentMsg[]; tools: AgentToolSpec[] },
  debug = false,
): Promise<AgentReply> {
  const base = (env as any).LLM_BASE_URL as string | undefined
  const key = (env as any).LLM_API_KEY as string | undefined
  const model = ((env as any).LLM_MODEL as string | undefined) ?? 'llama-3.3-70b-versatile'
  if (base && key) {
    try {
      return await viaOpenAI(base, key, model, req)
    } catch (e) {
      return { text: '', calls: [], stop: 'error', error: String((e as Error)?.message ?? e) }
    }
  }

  try {
    const out = await env.AI.run(WORKERS_AI_MODEL as any, {
      messages: toWire(req.messages),
      tools: req.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    } as any) as any
    // Workers AI answers in two shapes depending on the model. Some return a
    // flat { response, tool_calls }, others the OpenAI choices envelope. Read
    // both, because getting this wrong means the agent's closing message is
    // silently always empty.
    const msg = out?.choices?.[0]?.message
    const calls = normaliseCalls(out?.tool_calls ?? msg?.tool_calls)
    const text = String(out?.response ?? msg?.content ?? '')
    return {
      text,
      calls,
      stop: calls.length ? 'tools' : 'stop',
      ...(debug ? { error: 'raw: ' + JSON.stringify(out).slice(0, 700) } : {}),
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    // The free tier fails rather than charging, which is the behaviour we want,
    // but it means the page has to say so plainly instead of looking broken.
    const quota = /neuron|quota|limit|429/i.test(msg)
    return {
      text: '', calls: [], stop: 'error',
      error: quota ? 'The daily free allowance for this model is used up. Try again tomorrow, or drive the room yourself.' : msg,
    }
  }
}
