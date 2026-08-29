// The Worker. Serves the built site, and proxies one LLM call at a time.
//
// It is deliberately stateless and knows nothing about rooms. It does not
// receive the room id, it stores nothing, and it logs nothing. That is worth
// stating plainly rather than implying: the proxy does see the conversation,
// because it has to. What it never does is keep it, and what the steward sees
// is a different thing entirely, built from tool calls rather than words.

import { complete, type AgentMsg, type AgentToolSpec } from './llm.js'

const MAX_BODY = 32 * 1024
const MAX_MESSAGES = 40
const MAX_TOOLS = 24

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/api/agent') {
      if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

      const raw = await req.text()
      if (raw.length > MAX_BODY) return json({ error: 'body too large' }, 413)

      let body: { messages?: AgentMsg[]; tools?: AgentToolSpec[] }
      try {
        body = JSON.parse(raw)
      } catch {
        return json({ error: 'bad json' }, 400)
      }

      const messages = Array.isArray(body.messages) ? body.messages : []
      const tools = Array.isArray(body.tools) ? body.tools : []
      if (!messages.length) return json({ error: 'no messages' }, 400)
      if (messages.length > MAX_MESSAGES) return json({ error: 'too many messages' }, 400)
      if (tools.length > MAX_TOOLS) return json({ error: 'too many tools' }, 400)

      const debug = url.searchParams.has('debug')
      const reply = await complete(env, { messages, tools }, debug)
      return json(reply)
    }

    return env.ASSETS.fetch(req)
  },
}
