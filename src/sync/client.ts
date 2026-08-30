// The client half of the room connection.
//
// The store is local first, so this is a fan out channel rather than a data
// source. Everything it carries is an op, and ops only ever describe the
// shared half of a room: work items, events and approvals. Private drafts and
// agent conversations are not ops, so there is nothing here for them to leak
// through.

import type { Envelope } from '../engine/ops.js'

export type Status = 'connecting' | 'open' | 'closed'

export interface Transport {
  send(env: Envelope): void
  close(): void
  readonly status: Status
}

export interface Knocker { id: string; name: string; at: number }

export interface Welcome {
  role: 'steward' | 'member'
  first: boolean
  title?: string
  defId?: string
  /** open: the link is the whole gate. ask: the steward lets each person in. */
  door?: 'open' | 'ask'
  /** Steward only. Who is at the door right now. */
  waiting?: Knocker[]
  /** Everything that happened before this client arrived. Handed to the page
   *  rather than applied here, because the page may replace its store on
   *  learning what kind of room this is, and history applied to the store it
   *  is about to throw away is history lost. */
  ops: Envelope[]
}

export function connectRoom(a: {
  roomId: string
  /** The secret from the link. This is the credential, and the server decides
   *  what it is worth. The page never assigns itself a role. */
  secret: string
  since: () => number
  onEnvelope: (env: Envelope) => void
  onWelcome: (w: Welcome) => void
  onDenied?: () => void
  /** This browser is at a door that is set to ask, and nobody has opened it. */
  onWaiting?: () => void
  /** Steward only. Somebody is knocking, or the list changed. */
  onKnock?: (waiting: Knocker[], door?: 'open' | 'ask') => void
  /** Who is knocking. The server needs a name to show the steward. */
  who?: { id: string; name: string }
  onRefused?: (need: string) => void
  onStatus?: (s: Status) => void
}): Transport {
  const url = `${location.origin.replace(/^http/, 'ws')}/api/room/${a.roomId}/ws`
  let ws: WebSocket | null = null
  let status: Status = 'connecting'
  let closed = false
  let backoff = 400
  const queue: Envelope[] = []

  const setStatus = (s: Status) => { status = s; a.onStatus?.(s) }

  const flush = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    while (queue.length) {
      const env = queue.shift()
      if (env) ws.send(JSON.stringify({ t: 'op', env }))
    }
  }

  const open = () => {
    if (closed) return
    setStatus('connecting')
    ws = new WebSocket(url)

    ws.addEventListener('open', () => {
      backoff = 400
      setStatus('open')
      ws?.send(JSON.stringify({ t: 'hello', since: a.since(), key: a.secret, ...(a.who ? { who: a.who } : {}) }))
      flush()
    })

    ws.addEventListener('message', ev => {
      let msg: any
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.t === 'welcome') {
        a.onWelcome({
          role: msg.role, first: Boolean(msg.first), title: msg.title, defId: msg.defId,
          door: msg.door, waiting: msg.waiting, ops: msg.ops ?? [],
        })
      } else if (msg.t === 'waiting') {
        a.onWaiting?.()
      } else if (msg.t === 'knock') {
        a.onKnock?.(msg.waiting ?? [], msg.door)
      } else if (msg.t === 'ops') {
        for (const env of msg.ops ?? []) a.onEnvelope(env)
      } else if (msg.t === 'denied') {
        closed = true
        a.onDenied?.()
        ws?.close()
      } else if (msg.t === 'refused') {
        a.onRefused?.(String(msg.need ?? 'a different role'))
      }
    })

    const retry = () => {
      if (closed) return
      setStatus('closed')
      setTimeout(open, backoff)
      backoff = Math.min(backoff * 2, 5000)
    }
    ws.addEventListener('close', retry)
    ws.addEventListener('error', () => ws?.close())
  }

  open()

  return {
    get status() { return status },
    send(env) {
      queue.push(env)
      flush()
    },
    close() {
      closed = true
      ws?.close()
      setStatus('closed')
    },
  }
}
