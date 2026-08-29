// Local first. A dispatch applies to local state and notifies subscribers
// synchronously, then hands the envelope to whatever transport is attached.
// The Durable Object is a fan out and ordering service, not the source of
// truth for the client that just called it.
//
// That choice is what lets RoomTool.run stay synchronous, which in turn is
// what keeps the room files small and readable.

import type { Person, RoomDefinition, RoomState } from '../types.js'
import { applyOp, makeEnvelope, type Envelope, type Op, type Role } from './ops.js'

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'unknown'

export interface RoomStore {
  readonly state: RoomState
  readonly roomKey: string
  subscribe(fn: (s: RoomState) => void): () => void
  /** Apply now, publish after. Returns the envelope so callers can track it. */
  dispatch(op: Op): Envelope
  /** From the transport. A self echo advances seq without re-applying. */
  receive(env: Envelope): void
  lastSeq(): number
  approvalStatus(id: string): ApprovalStatus
  setSink(sink: ((env: Envelope) => void) | null): void
  /** Called once, by whichever client the server says arrived first. */
  seedIfFirst(isFirst: boolean): void
}

export function createStore(args: {
  def: RoomDefinition
  roomKey: string
  me: Person
  role: Role
}): RoomStore {
  const { def, roomKey, me, role } = args

  const state: RoomState = {
    def,
    steward: role === 'steward' ? me : { id: 'steward', name: def.stewardRole, colour: '#8a9a9a' },
    members: role === 'member' ? [me] : [],
    items: [],
    events: [],
    approvals: [],
  }

  const subs = new Set<(s: RoomState) => void>()
  const mine = new Set<string>()
  const settled = new Map<string, boolean>()
  let sink: ((env: Envelope) => void) | null = null
  let seq = 0
  let seeded = false

  const notify = () => { for (const fn of subs) fn(state) }

  const track = (env: Envelope) => {
    if (env.op.k === 'settle') settled.set(env.op.approvalId, env.op.ok)
    if (env.seq > seq) seq = env.seq
  }

  const store: RoomStore = {
    state,
    roomKey,

    subscribe(fn) {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },

    dispatch(op) {
      const env = makeEnvelope(me.id, op)
      mine.add(env.id)
      applyOp(state, env)
      track(env)
      notify()
      sink?.(env)
      return env
    },

    receive(env) {
      if (mine.has(env.id)) {
        // Our own op coming back with a seq. Record the seq so a reconnect
        // asks for the right window, but do not apply it twice.
        if (env.seq > seq) seq = env.seq
        return
      }
      applyOp(state, env)
      track(env)
      notify()
    },

    lastSeq: () => seq,

    approvalStatus(id) {
      const done = settled.get(id)
      if (done === true) return 'approved'
      if (done === false) return 'denied'
      return state.approvals.some(a => a.id === id) ? 'pending' : 'unknown'
    },

    setSink(next) { sink = next },

    seedIfFirst(isFirst) {
      if (!isFirst || seeded) return
      seeded = true
      const people = state.members.length ? state.members : [me]
      for (const item of def.seed(people)) store.dispatch({ k: 'item', item })
    },
  }

  store.dispatch({ k: 'join', person: me, role })
  return store
}
