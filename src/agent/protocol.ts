// The wire shapes between the page and /api/agent. Deliberately duplicated in
// worker/llm.ts rather than shared, so the browser bundle and the Worker
// bundle stay independent of each other.

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

export async function askModel(
  body: { messages: AgentMsg[]; tools: AgentToolSpec[] },
  signal?: AbortSignal,
): Promise<AgentReply> {
  const once = async (): Promise<AgentReply> => {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) {
      return { text: '', calls: [], stop: 'error', error: `agent endpoint returned ${res.status}` }
    }
    return await res.json() as AgentReply
  }

  try {
    return await once()
  } catch (e) {
    if (signal?.aborted) return { text: '', calls: [], stop: 'error', error: 'stopped' }
    await new Promise(r => setTimeout(r, 800))
    try {
      return await once()
    } catch (err) {
      return { text: '', calls: [], stop: 'error', error: String((err as Error)?.message ?? err) }
    }
  }
}
