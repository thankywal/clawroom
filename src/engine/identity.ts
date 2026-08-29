// Who you are in a room, and where your private half lives.
//
// Identity is a local id and a display name, nothing more. There is no account
// and no login, partly because judges have to be able to open a link and use
// the thing, and partly because a room that required accounts would need a
// server that knows who its members are, which is the opposite of the point.

import type { MemberId, Person, Scratch } from '../types.js'

const ME_KEY = 'clawroom:me'

const PALETTE = ['#3fa9ac', '#a980e0', '#e0a44a', '#5fb87a', '#d97a8f', '#6f9de0']

function pickColour(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] ?? '#3fa9ac'
}

const NAMES = ['Mya', 'Ben', 'Su', 'Aung', 'Lin', 'Nita', 'Ko', 'Thiri']

function read(): Person | null {
  try {
    const raw = localStorage.getItem(ME_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Person>
    if (typeof p.id === 'string' && typeof p.name === 'string') {
      return { id: p.id, name: p.name, colour: p.colour ?? pickColour(p.id) }
    }
  } catch {
    // A corrupt entry is not worth surfacing. Fall through and mint a new one.
  }
  return null
}

export function me(): Person {
  const existing = read()
  if (existing) return existing
  const id = crypto.randomUUID()
  const person: Person = {
    id,
    name: NAMES[Math.floor(Math.random() * NAMES.length)] ?? 'Guest',
    colour: pickColour(id),
  }
  localStorage.setItem(ME_KEY, JSON.stringify(person))
  return person
}

export function setName(name: string): Person {
  const person = { ...me(), name: name.trim() || 'Guest' }
  localStorage.setItem(ME_KEY, JSON.stringify(person))
  return person
}

const prefix = (roomKey: string, id: MemberId) => `clawroom:${roomKey}:${id}:`

/**
 * The private half of a room. Work-tier tools keep their payload here, and so
 * does the agent transcript. Nothing under this prefix is ever synced, logged,
 * or readable by any tool in the engine.
 */
export function scratchFor(roomKey: string, id: MemberId): Scratch {
  const p = prefix(roomKey, id)
  return {
    get(key) {
      const raw = localStorage.getItem(p + key)
      if (raw === null) return undefined
      try { return JSON.parse(raw) } catch { return raw }
    },
    set(key, value) {
      localStorage.setItem(p + key, JSON.stringify(value))
    },
    keys() {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(p)) out.push(k.slice(p.length))
      }
      return out
    },
  }
}

/** Wipes everything the room never had in the first place. Worth a button. */
export function clearPrivate(roomKey: string, id: MemberId): number {
  const p = prefix(roomKey, id)
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(p)) doomed.push(k)
  }
  for (const k of doomed) localStorage.removeItem(k)
  return doomed.length
}
