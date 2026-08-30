// Bringing your own model.
//
// The room hosts an agent so that a visitor with no subscription can still see
// the loop run. That agent is a 70B on Workers AI, which is good enough to
// drive a room and not as good as what most people in this contest already pay
// for. So the page lets you point it somewhere else.
//
// Where the key lives matters, and the answer is the same as everywhere else
// in this project: your machine. It sits in localStorage next to your drafts,
// it is sent with each request to this site's own /api/agent, which forwards
// it to the endpoint you named and keeps nothing. It never reaches the room,
// the Durable Object, or another member. No tool in this engine can read it,
// for the same reason no tool can read a draft.
//
// It is still a key in a browser, travelling through somebody else's worker.
// LIMITS.md says that plainly. Use a scoped or throwaway key.

const KEY = 'clawroom:model'

export interface Provider {
  /** An OpenAI-compatible base, for example https://api.openai.com/v1 */
  base: string
  key: string
  model: string
}

export function savedProvider(): Provider | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Provider>
    if (!p.base || !p.key || !p.model) return null
    return { base: String(p.base), key: String(p.key), model: String(p.model) }
  } catch {
    return null
  }
}

export function saveProvider(p: Provider | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p))
    else localStorage.removeItem(KEY)
  } catch { /* a browser with storage off keeps the built in model */ }
}

/** What to show in the header. Never the key. */
export function providerLabel(): string {
  const p = savedProvider()
  return p ? p.model : 'llama 3.3 70b on Workers AI'
}

/** A few that people in this contest are likely to hold, so the form is two
 *  fields rather than three for most of them. */
export const PRESETS: { name: string; base: string; model: string }[] = [
  { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-5' },
  { name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5' },
  { name: 'Anything OpenAI compatible', base: '', model: '' },
]
