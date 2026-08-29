// Patterns over the work log worth putting in front of the steward.
//
// A room declares its own signals. They read the same event log everyone can
// see, which means a signal can never reveal something the steward was not
// already entitled to know.

import type { FiredSignal, RoomState } from '../types.js'

export function evaluateSignals(state: RoomState): FiredSignal[] {
  const out: FiredSignal[] = []
  for (const sig of state.def.signals) {
    const text = sig.detect(state.events, state)
    if (text) out.push({ id: sig.id, label: sig.label, text })
  }
  return out
}

/** Handy for room authors: how many distinct members called this tool. */
export function distinctCallers(state: RoomState, tool: string, item?: string): number {
  const who = new Set<string>()
  for (const e of state.events) {
    if (e.tool !== tool) continue
    if (item && e.item !== item) continue
    who.add(e.actor)
  }
  return who.size
}

/** Handy for room authors: how many times one member called one tool. */
export function callCount(state: RoomState, tool: string, actor?: string): number {
  return state.events.filter(e => e.tool === tool && (!actor || e.actor === actor)).length
}
