// One Durable Object per room. It stamps a sequence number on every envelope,
// keeps them in order, fans them out, and decides who is allowed to do what.
//
// The last part is the one that matters. A room hands out two links when it is
// created, and the secret in the link is the credential. The steward link can
// approve; the member link cannot. That check lives here rather than in the
// page, because a check in the page is a suggestion.
//
// It still does not know what a room is. Definitions never cross the wire,
// only the id, so the server cannot tell a marketing department from a
// classroom. And it never sees a private draft or a conversation, because
// those are not ops.

import type { Envelope } from '../src/engine/ops.js'

const KEEP = 500
const RATE_PER_SEC = 20

export type Role = 'steward' | 'member'

export interface RoomConfig {
  defId: string
  title: string
  stewardHash: string
  memberHash: string
  createdAt: number
}

interface Hello { t: 'hello'; since: number; key: string }
interface OpMsg { t: 'op'; env: Envelope }
interface Ping { t: 'ping' }
type Inbound = Hello | OpMsg | Ping

const key = (seq: number) => `op:${String(seq).padStart(9, '0')}`

export async function hash(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Constant time compare, so a wrong key cannot be found one character at a
 *  time by measuring how long the rejection took. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export class RoomDO implements DurableObject {
  private seq = 0
  private seeded = false
  private config: RoomConfig | null = null
  private hits = new Map<WebSocket, { at: number; n: number }>()

  constructor(private ctx: DurableObjectState, _env: Env) {
    this.ctx.blockConcurrencyWhile(async () => {
      this.seq = (await this.ctx.storage.get<number>('seq')) ?? 0
      this.seeded = (await this.ctx.storage.get<boolean>('seeded')) ?? false
      this.config = (await this.ctx.storage.get<RoomConfig>('config')) ?? null
    })
  }

  private async roleFor(secret: string): Promise<Role | null> {
    if (!this.config) return null
    const h = await hash(secret)
    if (same(h, this.config.stewardHash)) return 'steward'
    if (same(h, this.config.memberHash)) return 'member'
    return null
  }

  private async since(from: number): Promise<Envelope[]> {
    const rows = await this.ctx.storage.list<Envelope>({ prefix: 'op:', start: key(from + 1) })
    return [...rows.values()]
  }

  /** Exactly one client is ever told it is first, inside the same turn that
   *  flips the flag, so two tabs opening together cannot both seed. */
  private async claimFirst(): Promise<boolean> {
    if (this.seeded) return false
    this.seeded = true
    await this.ctx.storage.put('seeded', true)
    return true
  }

  private async accept(env: Envelope): Promise<Envelope> {
    const stamped: Envelope = { ...env, seq: ++this.seq }
    await this.ctx.storage.put(key(stamped.seq), stamped)
    await this.ctx.storage.put('seq', this.seq)
    if (this.seq > KEEP) await this.ctx.storage.delete(key(this.seq - KEEP))
    return stamped
  }

  private broadcast(payload: unknown): void {
    const text = JSON.stringify(payload)
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(text) } catch { /* a closing socket is not worth handling */ }
    }
  }

  private limited(ws: WebSocket): boolean {
    const now = Date.now()
    const seen = this.hits.get(ws)
    if (!seen || now - seen.at > 1000) { this.hits.set(ws, { at: now, n: 1 }); return false }
    seen.n++
    return seen.n > RATE_PER_SEC
  }

  /** The authorisation rule, in one place. Approving and declining is the
   *  steward's alone; everything else any member of the room may do. */
  private allowed(role: Role, env: Envelope): boolean {
    if (env.op.k === 'settle') return role === 'steward'
    return true
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname.endsWith('/create') && req.method === 'POST') {
      if (this.config) return Response.json({ error: 'room already exists' }, { status: 409 })
      const body = await req.json() as { defId?: string; title?: string; steward?: string; member?: string }
      if (!body.steward || !body.member) return Response.json({ error: 'missing keys' }, { status: 400 })
      this.config = {
        defId: String(body.defId ?? 'campaign'),
        title: String(body.title ?? 'Untitled room'),
        stewardHash: await hash(body.steward),
        memberHash: await hash(body.member),
        createdAt: Date.now(),
      }
      await this.ctx.storage.put('config', this.config)
      // Kept so a steward can produce the invite link later, on any device.
      // The steward secret is never stored, only its hash.
      await this.ctx.storage.put('memberKey', body.member)
      return Response.json({ ok: true })
    }

    if (url.pathname.endsWith('/meta')) {
      if (!this.config) return Response.json({ error: 'no such room' }, { status: 404 })
      const secret = url.searchParams.get('k') ?? ''
      const role = await this.roleFor(secret)
      if (!role) return Response.json({ error: 'not your room' }, { status: 403 })
      // A steward can hand out the member link, which is the whole invite
      // mechanism. A member cannot, so a member link cannot mint more access
      // than it already has.
      const invite = role === 'steward' ? await this.ctx.storage.get<string>('memberKey') : undefined
      return Response.json({
        role, defId: this.config.defId, title: this.config.title,
        ...(invite ? { invite } : {}),
      })
    }

    if (req.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('room', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: Inbound
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) } catch { return }

    if (msg.t === 'ping') { ws.send(JSON.stringify({ t: 'pong' })); return }

    if (msg.t === 'hello') {
      const role = await this.roleFor(msg.key ?? '')
      if (!role) { ws.send(JSON.stringify({ t: 'denied' })); return }
      // The role rides with the socket, so a later op cannot claim a different
      // one. Hibernation restores the attachment, so this survives idle time.
      ws.serializeAttachment({ role })
      const first = msg.since === 0 ? await this.claimFirst() : false
      ws.send(JSON.stringify({
        t: 'welcome', role, first,
        title: this.config?.title, defId: this.config?.defId,
        ops: await this.since(msg.since ?? 0),
      }))
      return
    }

    if (msg.t === 'op') {
      const att = ws.deserializeAttachment() as { role?: Role } | null
      const role = att?.role
      if (!role) { ws.send(JSON.stringify({ t: 'denied' })); return }
      if (!this.allowed(role, msg.env)) {
        ws.send(JSON.stringify({ t: 'refused', op: msg.env.op.k, need: 'steward' }))
        return
      }
      if (this.limited(ws)) { ws.send(JSON.stringify({ t: 'slow' })); return }
      const stamped = await this.accept(msg.env)
      this.broadcast({ t: 'ops', ops: [stamped] })
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.hits.delete(ws)
  }
}
