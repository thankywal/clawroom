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
  for (const sig of computerSignals(state)) out.push(sig)
  return out
}

/** Exit code parsed from a computer_run summary, which reads like
 *  "ran `python3 x.py` (exit 1, 0 lines out)". Null when it is not one. */
export function exitCodeOf(summary: string): number | null {
  const m = /\(exit (-?\d+),/.exec(summary)
  return m?.[1] !== undefined ? Number(m[1]) : null
}

const nameOf = (state: RoomState, id: string): string =>
  state.members.find(p => p.id === id)?.name ?? (state.steward.id === id ? state.steward.name : 'someone')

/**
 * Every room gets these, because every member gets a computer. They read the
 * same public log as everything else, so the most a signal can say is what
 * the log already says: a run failed, and how many in a row.
 */
export function computerSignals(state: RoomState): FiredSignal[] {
  const out: FiredSignal[] = []
  const streak = new Map<string, number>()
  for (const e of state.events) {
    if (e.tool !== 'computer_run') continue
    const code = exitCodeOf(e.summary)
    if (code === null) continue
    streak.set(e.actor, code === 0 ? 0 : (streak.get(e.actor) ?? 0) + 1)
  }
  for (const [actor, n] of streak) {
    if (n >= 3) {
      out.push({
        id: `computer-stuck:${actor}`,
        label: 'Stuck on their computer',
        text: `${nameOf(state, actor)}'s agent has had ${n} failed commands in a row. It may be going in circles.`,
      })
    }
  }
  return out
}

/** Per member, what their computer has been asked to do. Counts only. */
export function computerUsage(state: RoomState): { actor: string; name: string; runs: number; failed: number; writes: number; shares: number; last: number }[] {
  const by = new Map<string, { runs: number; failed: number; writes: number; shares: number; last: number }>()
  for (const e of state.events) {
    if (!e.tool.startsWith('computer_')) continue
    const u = by.get(e.actor) ?? { runs: 0, failed: 0, writes: 0, shares: 0, last: 0 }
    if (e.tool === 'computer_run') { u.runs++; if ((exitCodeOf(e.summary) ?? 0) !== 0) u.failed++ }
    if (e.tool === 'computer_write_file') u.writes++
    if (e.tool === 'computer_share_file') u.shares++
    u.last = Math.max(u.last, e.at)
    by.set(e.actor, u)
  }
  return [...by].map(([actor, u]) => ({ actor, name: nameOf(state, actor), ...u }))
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
