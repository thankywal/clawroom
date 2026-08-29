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

export function connectRoom(a: {
  roomKey: string
  since: () => number
  onEnvelope: (env: Envelope) => void
  onFirst: (isFirst: boolean) => void
  onStatus?: (s: Status) => void
}): Transport {
  const url = `${location.origin.replace(/^http/, 'ws')}/api/room/${a.roomKey}/ws`
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
      ws?.send(JSON.stringify({ t: 'hello', since: a.since() }))
      flush()
    })

    ws.addEventListener('message', ev => {
      let msg: any
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.t === 'sync') {
        for (const env of msg.ops ?? []) a.onEnvelope(env)
        a.onFirst(Boolean(msg.first))
      } else if (msg.t === 'ops') {
        for (const env of msg.ops ?? []) a.onEnvelope(env)
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
