// One Durable Object per room. It stamps a sequence number on every envelope,
// keeps them in order, and fans them out. That is the entire job.
//
// It does not know what a room is. Room definitions never cross the wire, only
// the room key, so the server cannot tell a marketing department from a
// classroom. The framework claim is structural rather than asserted.
//
// It also never sees a private draft or a conversation, because those are not
// ops. Work-tier payloads stay in the member's browser by construction.

import type { Envelope } from '../src/engine/ops.js'

const KEEP = 500
const RATE_PER_SEC = 20

interface Hello { t: 'hello'; since: number }
interface OpMsg { t: 'op'; env: Envelope }
interface Ping { t: 'ping' }
type Inbound = Hello | OpMsg | Ping

const key = (seq: number) => `op:${String(seq).padStart(9, '0')}`

export class RoomDO implements DurableObject {
  private seq = 0
  private seeded = false
  private hits = new Map<WebSocket, { at: number; n: number }>()

  constructor(private ctx: DurableObjectState, _env: Env) {
    this.ctx.blockConcurrencyWhile(async () => {
      this.seq = (await this.ctx.storage.get<number>('seq')) ?? 0
      this.seeded = (await this.ctx.storage.get<boolean>('seeded')) ?? false
    })
  }

  private async since(from: number): Promise<Envelope[]> {
    const rows = await this.ctx.storage.list<Envelope>({ prefix: 'op:', start: key(from + 1) })
    return [...rows.values()]
  }

  /** Exactly one client is ever told it is first, and it is told inside the
   *  same turn that flips the flag, which is how two tabs opening together
   *  cannot both seed the same room. */
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

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (req.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    // The polling fallback speaks the same op log, so a network that eats
    // WebSockets costs liveness and nothing else.
    if (url.pathname.endsWith('/sync') && req.method === 'POST') {
      const body = await req.json() as { since?: number; ops?: Envelope[] }
      const out: Envelope[] = []
      for (const env of body.ops ?? []) out.push(await this.accept(env))
      if (out.length) this.broadcast({ t: 'ops', ops: out })
      const first = (body.since ?? 0) === 0 ? await this.claimFirst() : false
      return Response.json({ ops: await this.since(body.since ?? 0), first })
    }

    return new Response('room', { status: 200 })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: Inbound
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) } catch { return }

    if (msg.t === 'ping') { ws.send(JSON.stringify({ t: 'pong' })); return }

    if (msg.t === 'hello') {
      const first = msg.since === 0 ? await this.claimFirst() : false
      ws.send(JSON.stringify({ t: 'sync', ops: await this.since(msg.since ?? 0), first }))
      return
    }

    if (msg.t === 'op') {
      if (this.limited(ws)) { ws.send(JSON.stringify({ t: 'slow' })); return }
      const stamped = await this.accept(msg.env)
      this.broadcast({ t: 'ops', ops: [stamped] })
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.hits.delete(ws)
  }
}
