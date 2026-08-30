// The Worker. Serves the built site, and proxies one LLM call at a time.
//
// It is deliberately stateless and knows nothing about rooms. It does not
// receive the room id, it stores nothing, and it logs nothing. That is worth
// stating plainly rather than implying: the proxy does see the conversation,
// because it has to. What it never does is keep it, and what the steward sees
// is a different thing entirely, built from tool calls rather than words.

import { complete, type AgentMsg, type AgentToolSpec } from './llm.js'
export { RoomDO } from './room-do.js'
export { Sandbox } from '@cloudflare/sandbox'
import { handleDesk } from './desk.js'
import { handleSource } from './source.js'
import { handleDemoApi } from './demo-api.js'

const MAX_BODY = 32 * 1024
const MAX_MESSAGES = 40
const MAX_TOOLS = 24

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Unguessable, and readable enough to paste into a chat without mangling. */
function secret(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('')
}

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

      let body: { messages?: AgentMsg[]; tools?: AgentToolSpec[]; byo?: { base?: string; key?: string; model?: string } }
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
      // Forwarded, never kept. See the note in worker/llm.ts.
      const byo = body.byo?.base && body.byo?.key
        ? { base: String(body.byo.base), key: String(body.byo.key), model: String(body.byo.model ?? '') }
        : undefined
      const reply = await complete(env, { messages, tools, ...(byo ? { byo } : {}) }, debug)
      return json(reply)
    }

    // Creating a room mints two secrets. The Worker generates them, hands them
    // to the caller once, and stores only their hashes in the room, so the
    // links are the credential and nothing on the server can reproduce them.
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = await req.json().catch(() => null) as { defId?: string; title?: string } | null
      if (!body) return json({ error: 'bad json' }, 400)
      const roomId = secret(10)
      const steward = 's_' + secret(24)
      const member = 'm_' + secret(24)
      const res = await env.ROOM.get(env.ROOM.idFromName(roomId)).fetch(
        new Request('https://room/create', {
          method: 'POST',
          body: JSON.stringify({ defId: body.defId, title: body.title, steward, member }),
        }),
      )
      if (!res.ok) return json({ error: 'could not create room' }, 500)
      return json({ roomId, steward, member })
    }

    // /api/desk/<roomId>: a member's own computer. Authenticated against the
    // room, addressed by a desk secret only the member's browser holds.
    const desk = url.pathname.match(/^\/api\/desk\/([^/]+)$/)
    if (desk) return handleDesk(req, env, desk[1]!)

    // /api/source/<roomId>: reads a tool description from another origin, and
    // proxies the calls the borrowed tools make. See worker/source.ts.
    const source = url.pathname.match(/^\/api\/source\/([^/]+)$/)
    if (source) return handleSource(req, env, source[1]!)

    // A fixture API, so the tool-source feature has a URL that works on the
    // first try. Not part of the room engine. See worker/demo-api.ts.
    if (url.pathname.startsWith('/api/demo')) {
      return handleDemoApi(req, url.pathname.slice('/api/demo'.length))
    }

    // /api/room/<roomId>/(ws|meta). The Worker uses the id to pick a Durable
    // Object and nothing else; it never learns what kind of room it is.
    const room = url.pathname.match(/^\/api\/room\/([^/]+)\/(ws|meta|rotate|delete)$/)
    if (room) {
      const [, roomId] = room
      return env.ROOM.get(env.ROOM.idFromName(roomId!)).fetch(req)
    }

    return env.ASSETS.fetch(req)
  },
}
