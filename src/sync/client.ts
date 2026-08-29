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

export interface Welcome {
  role: 'steward' | 'member'
  first: boolean
  title?: string
  defId?: string
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
      ws?.send(JSON.stringify({ t: 'hello', since: a.since(), key: a.secret }))
      flush()
    })

    ws.addEventListener('message', ev => {
      let msg: any
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.t === 'welcome') {
        for (const env of msg.ops ?? []) a.onEnvelope(env)
        a.onWelcome({ role: msg.role, first: Boolean(msg.first), title: msg.title, defId: msg.defId })
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
