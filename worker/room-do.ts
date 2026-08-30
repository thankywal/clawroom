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
  /** open: the invite link is the whole gate. ask: the steward also has to
   *  let each person in. Off by default, because a room nobody can enter is
   *  a worse first impression than one anybody with the link can. */
  door?: 'open' | 'ask'
}

interface Knocker { id: string; name: string; at: number }

interface Hello { t: 'hello'; since: number; key: string; who?: { id: string; name: string } }
interface OpMsg { t: 'op'; env: Envelope }
interface Ping { t: 'ping' }
type Inbound = Hello | OpMsg | Ping

/** A room hands out at most this many computers, ever. */
const MAX_DESKS = 12

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
  private admitted = new Set<string>()
  /** Desk ids this room has seen. A sandbox costs money and a room key is a
   *  bearer secret, so a room that will mint machines without limit is a bill
   *  waiting to happen. Capped rather than left to good manners. */
  private desks = new Set<string>()
  private waiting = new Map<string, Knocker>()
  private hits = new Map<WebSocket, { at: number; n: number }>()

  constructor(private ctx: DurableObjectState, _env: Env) {
    this.ctx.blockConcurrencyWhile(async () => {
      this.seq = (await this.ctx.storage.get<number>('seq')) ?? 0
      this.seeded = (await this.ctx.storage.get<boolean>('seeded')) ?? false
      this.config = (await this.ctx.storage.get<RoomConfig>('config')) ?? null
      this.admitted = new Set(await this.ctx.storage.get<string[]>('admitted') ?? [])
      this.desks = new Set(await this.ctx.storage.get<string[]>('desks') ?? [])
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

  /** Only the steward's sockets, for the knock list. Members never learn who
   *  is waiting outside, the same way they never see each other's drafts. */
  private tellSteward(payload: unknown): void {
    const text = JSON.stringify(payload)
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as { role?: Role } | null
      if (att?.role !== 'steward') continue
      try { ws.send(text) } catch { /* a closing socket is not worth handling */ }
    }
  }

  private knockList(): Knocker[] {
    return [...this.waiting.values()].sort((a, b) => a.at - b.at)
  }

  private async welcome(ws: WebSocket, role: Role, since: number): Promise<void> {
    const first = since === 0 ? await this.claimFirst() : false
    ws.send(JSON.stringify({
      t: 'welcome', role, first,
      title: this.config?.title, defId: this.config?.defId,
      door: this.config?.door ?? 'open',
      ...(role === 'steward' ? { waiting: this.knockList() } : {}),
      ops: await this.since(since),
    }))
  }

  private limited(ws: WebSocket): boolean {
    const now = Date.now()
    const seen = this.hits.get(ws)
    if (!seen || now - seen.at > 1000) { this.hits.set(ws, { at: now, n: 1 }); return false }
    seen.n++
    return seen.n > RATE_PER_SEC
  }

  /**
   * The authorisation rule, in one place.
   *
   * This used to gate `settle` and wave everything else through, and that was
   * wrong in a way that mattered. A member on a raw socket could send an
   * `item` op marking a post published, or an `event` op with
   * `kind: 'human'` and somebody else's name on it, and every honest client
   * in the room would render it. The manager's log is the product. A log the
   * watched party can write is not a log.
   *
   * So the server now stamps who sent an envelope and refuses any op that
   * claims to be from somebody else. Sources are the steward's alone, because
   * a member's route to a source is the commit-tier tool that parks for one.
   */
  private allowed(role: Role, env: Envelope, id: string): boolean {
    const op = env.op
    // Only a person can approve, and only the steward is that person.
    if (op.k === 'settle') return role === 'steward'
    // Tools reach the room by being approved, not by being announced.
    if (op.k === 'source' || op.k === 'unsource') return role === 'steward'
    if (role === 'steward') return true

    // Everything below is a member claiming to have done something.
    if (op.k === 'join') return op.person.id === id && op.role === 'member'
    if (op.k === 'event') return op.event.actor === id && op.event.kind !== 'human'
    if (op.k === 'item') return !op.item.owner || op.item.owner === id
    if (op.k === 'ask') return op.approval.requestedBy === id
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

    // A steward can retire the invite link. A new member secret is minted,
    // only its hash is kept, and every member socket is closed so the old
    // link stops working now rather than at the next reconnect.
    if (url.pathname.endsWith('/rotate') && req.method === 'POST') {
      if (!this.config) return Response.json({ error: 'no such room' }, { status: 404 })
      const secret = url.searchParams.get('k') ?? ''
      if ((await this.roleFor(secret)) !== 'steward') return Response.json({ error: 'steward only' }, { status: 403 })
      const member = 'm_' + [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
      this.config = { ...this.config, memberHash: await hash(member) }
      await this.ctx.storage.put('config', this.config)
      await this.ctx.storage.put('memberKey', member)
      for (const ws of this.ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as { role?: Role } | null
        if (att?.role === 'member') { try { ws.send(JSON.stringify({ t: 'denied' })); ws.close(1000, 'invite rotated') } catch { /* closing */ } }
      }
      return Response.json({ ok: true, invite: member })
    }

    // How many machines this room has handed out, and whether it will hand
    // out one more. Called by the desk endpoint before it wakes a sandbox.
    if (url.pathname.endsWith('/desk') && req.method === 'POST') {
      if (!this.config) return Response.json({ error: 'no such room' }, { status: 404 })
      if (!(await this.roleFor(url.searchParams.get('k') ?? ''))) {
        return Response.json({ error: 'not your room' }, { status: 403 })
      }
      const desk = url.searchParams.get('desk') ?? ''
      if (!desk) return Response.json({ error: 'no desk' }, { status: 400 })
      if (!this.desks.has(desk)) {
        if (this.desks.size >= MAX_DESKS) {
          return Response.json(
            { error: `this room has already handed out ${MAX_DESKS} computers, which is its limit` },
            { status: 429 },
          )
        }
        this.desks.add(desk)
        await this.ctx.storage.put('desks', [...this.desks])
      }
      return Response.json({ ok: true, desks: this.desks.size, limit: MAX_DESKS })
    }

    // The door. Open means the invite link is the whole gate, which is how a
    // room starts. Ask means the steward also has to let each person in.
    if (url.pathname.endsWith('/door') && req.method === 'POST') {
      if (!this.config) return Response.json({ error: 'no such room' }, { status: 404 })
      if ((await this.roleFor(url.searchParams.get('k') ?? '')) !== 'steward') {
        return Response.json({ error: 'steward only' }, { status: 403 })
      }
      const mode = url.searchParams.get('mode') === 'ask' ? 'ask' : 'open'
      this.config = { ...this.config, door: mode }
      await this.ctx.storage.put('config', this.config)
      // Opening the door lets in whoever was already knocking, rather than
      // leaving them staring at a page that will never change.
      if (mode === 'open') {
        for (const ws of this.ctx.getWebSockets()) {
          const att = ws.deserializeAttachment() as { role?: Role; id?: string } | null
          if (att?.role === 'member' && att.id && this.waiting.has(att.id)) {
            this.waiting.delete(att.id)
            await this.welcome(ws, 'member', 0)
          }
        }
      }
      this.tellSteward({ t: 'knock', waiting: this.knockList(), door: mode })
      return Response.json({ ok: true, door: mode })
    }

    // Letting one person in, or turning them away. Only a steward, and only
    // ever a person: there is no tool in the engine that can call this.
    if ((url.pathname.endsWith('/admit') || url.pathname.endsWith('/refuse')) && req.method === 'POST') {
      if (!this.config) return Response.json({ error: 'no such room' }, { status: 404 })
      if ((await this.roleFor(url.searchParams.get('k') ?? '')) !== 'steward') {
        return Response.json({ error: 'steward only' }, { status: 403 })
      }
      const id = url.searchParams.get('id') ?? ''
      const admit = url.pathname.endsWith('/admit')
      if (!this.waiting.has(id) && !this.admitted.has(id)) {
        return Response.json({ error: 'nobody by that name is waiting' }, { status: 404 })
      }
      this.waiting.delete(id)
      if (admit) {
        this.admitted.add(id)
        await this.ctx.storage.put('admitted', [...this.admitted])
      } else {
        this.admitted.delete(id)
        await this.ctx.storage.put('admitted', [...this.admitted])
      }
      for (const ws of this.ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as { role?: Role; id?: string } | null
        if (att?.role !== 'member' || att.id !== id) continue
        if (admit) await this.welcome(ws, 'member', 0)
        else { try { ws.send(JSON.stringify({ t: 'denied' })); ws.close(1000, 'not admitted') } catch { /* closing */ } }
      }
      this.tellSteward({ t: 'knock', waiting: this.knockList() })
      return Response.json({ ok: true })
    }

    // A steward can delete the room. Everything the Durable Object holds goes,
    // every socket is closed, and every key to it stops meaning anything.
    // Members' computers are theirs: the room never held their addresses, so
    // each member's own browser is what can destroy their sandbox.
    if (url.pathname.endsWith('/delete') && req.method === 'POST') {
      if (!this.config) return Response.json({ error: 'no such room' }, { status: 404 })
      const secret = url.searchParams.get('k') ?? ''
      if ((await this.roleFor(secret)) !== 'steward') return Response.json({ error: 'steward only' }, { status: 403 })
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(JSON.stringify({ t: 'denied' })); ws.close(1000, 'room deleted') } catch { /* closing */ }
      }
      await this.ctx.storage.deleteAll()
      this.config = null; this.seq = 0; this.seeded = false; this.hits.clear()
      this.admitted.clear(); this.waiting.clear(); this.desks.clear()
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
        door: this.config.door ?? 'open',
        ...(role === 'steward' ? { waiting: this.knockList() } : {}),
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
      const who = msg.who
      // The role rides with the socket so a later op cannot claim a different
      // one, and the person id rides with it so an admit can find them again.
      ws.serializeAttachment({ role, id: who?.id })

      const asking = (this.config?.door ?? 'open') === 'ask'
      if (role === 'member' && asking && who?.id && !this.admitted.has(who.id)) {
        this.waiting.set(who.id, { id: who.id, name: String(who.name ?? 'Someone').slice(0, 40), at: Date.now() })
        ws.send(JSON.stringify({ t: 'waiting' }))
        this.tellSteward({ t: 'knock', waiting: this.knockList() })
        return
      }
      await this.welcome(ws, role, msg.since ?? 0)
      return
    }

    if (msg.t === 'op') {
      const att = ws.deserializeAttachment() as { role?: Role; id?: string } | null
      const role = att?.role
      if (!role) { ws.send(JSON.stringify({ t: 'denied' })); return }
      // Somebody still at the door does not get to write to the room. The page
      // stops showing them the tools, and this is the half that means it: the
      // check that decides is the same one that decides whether they can see.
      if (role === 'member' && (this.config?.door ?? 'open') === 'ask' && att.id && !this.admitted.has(att.id)) {
        ws.send(JSON.stringify({ t: 'waiting' }))
        return
      }
      // No id means a client that never said who it was. It does not get to
      // write to a room whose whole point is knowing who did what.
      const id = att.id
      if (!id) { ws.send(JSON.stringify({ t: 'refused', op: msg.env.op.k, need: 'a name' })); return }
      if (!this.allowed(role, msg.env, id)) {
        ws.send(JSON.stringify({ t: 'refused', op: msg.env.op.k, need: 'steward' }))
        return
      }
      // The sender is the socket, not whatever the envelope says.
      msg.env.from = id
      if (this.limited(ws)) { ws.send(JSON.stringify({ t: 'slow' })); return }
      const stamped = await this.accept(msg.env)
      this.broadcast({ t: 'ops', ops: [stamped] })
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.hits.delete(ws)
  }
}
