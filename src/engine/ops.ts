// The sync envelope and the reducer that applies it.
//
// Pure. No DOM, no storage, no imports beyond the schema. The Worker imports
// its types from here with `import type`, so there is no runtime coupling
// between the browser and the Durable Object at all.
//
// One thing the room definition never does is cross the wire. Only its id
// travels, inside the room key. The server therefore never learns what a room
// is, which is the framework claim made structural rather than asserted.

import type { Approval, Event, MemberId, Person, RoomState, ToolSource, WorkItem } from '../types.js'

export type Role = 'steward' | 'member'

export type Op =
  | { k: 'join'; person: Person; role: Role }
  | { k: 'event'; event: Event }
  | { k: 'item'; item: WorkItem }
  | { k: 'ask'; approval: Approval }
  | { k: 'settle'; approvalId: string; by: MemberId; ok: boolean }
  | { k: 'source'; source: ToolSource }
  | { k: 'unsource'; sourceId: string }

export interface Envelope {
  /** Client generated, and the dedup key when the server echoes it back. */
  id: string
  /** Server assigned. Zero while the envelope is still local only. */
  seq: number
  at: number
  from: MemberId
  op: Op
}

export function makeEnvelope(from: MemberId, op: Op): Envelope {
  return { id: crypto.randomUUID(), seq: 0, at: Date.now(), from, op }
}

/** Mutates state in place. Every op is either an append or an idempotent
 *  upsert, which is why a single serialisation point in the Durable Object is
 *  enough and no CRDT is needed. */
export function applyOp(state: RoomState, env: Envelope): void {
  const op = env.op
  switch (op.k) {
    case 'join': {
      if (op.role === 'steward') {
        state.steward = op.person
        return
      }
      const at = state.members.findIndex(p => p.id === op.person.id)
      if (at === -1) state.members.push(op.person)
      else state.members[at] = op.person
      return
    }
    case 'event': {
      state.events.push(op.event)
      return
    }
    case 'item': {
      const at = state.items.findIndex(i => i.id === op.item.id)
      if (at === -1) state.items.push(op.item)
      else state.items[at] = op.item
      return
    }
    case 'ask': {
      if (!state.approvals.some(a => a.id === op.approval.id)) state.approvals.push(op.approval)
      return
    }
    case 'settle': {
      state.approvals = state.approvals.filter(a => a.id !== op.approvalId)
      return
    }
    case 'source': {
      const at = state.sources.findIndex(s => s.id === op.source.id)
      if (at === -1) state.sources.push(op.source)
      else state.sources[at] = op.source
      return
    }
    case 'unsource': {
      state.sources = state.sources.filter(s => s.id !== op.sourceId)
      return
    }
  }
}

/** One line for the commit list. Kept next to the reducer so a new op kind
 *  cannot be added without deciding how it reads. */
export function opSummary(env: Envelope): string {
  const op = env.op
  switch (op.k) {
    case 'join':   return `${op.person.name} joined as ${op.role}`
    case 'event':  return op.event.summary
    case 'item':   return `${op.item.title} is ${op.item.state}`
    case 'ask':    return `asked to ${op.approval.describe}`
    case 'settle': return op.ok ? 'approved' : 'declined'
    case 'source': return `added ${op.source.tools.length} tools from ${op.source.name}`
    case 'unsource': return 'removed a tool source'
  }
}
