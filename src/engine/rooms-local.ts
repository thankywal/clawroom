// The rooms you have links to, remembered in this browser.
//
// This is not an account. It is a list of capability links you happen to hold,
// which is why losing this browser loses your rooms unless you kept the link.
// That tradeoff is deliberate: there is no server-side list of who belongs to
// what, so there is nothing central to leak.

export interface SavedRoom {
  roomId: string
  secret: string
  title: string
  defId: string
  role: 'steward' | 'member'
  at: number
}

const KEY = 'clawroom:rooms'

export function savedRooms(): SavedRoom[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw as SavedRoom[] : []
  } catch {
    return []
  }
}

export function rememberRoom(room: SavedRoom): void {
  const rest = savedRooms().filter(r => r.roomId !== room.roomId)
  localStorage.setItem(KEY, JSON.stringify([room, ...rest].slice(0, 24)))
}

export function forgetRoom(roomId: string): void {
  localStorage.setItem(KEY, JSON.stringify(savedRooms().filter(r => r.roomId !== roomId)))
}

export function roomLink(roomId: string, secret: string): string {
  return `${location.origin}/room.html?r=${roomId}&k=${secret}`
}

export async function createRoom(a: { defId: string; title: string }): Promise<SavedRoom> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(a),
  })
  if (!res.ok) throw new Error('The room could not be created.')
  const { roomId, steward } = await res.json() as { roomId: string; steward: string; member: string }
  const room: SavedRoom = { roomId, secret: steward, title: a.title, defId: a.defId, role: 'steward', at: Date.now() }
  rememberRoom(room)
  return room
}

/** Asks the room what this link is worth. Also returns the invite link, but
 *  only to a steward, so a member link cannot mint more access than it has. */
/** Steward only. Mints a new member link; the old one stops working at once. */
export async function rotateInvite(roomId: string, secret: string): Promise<string | null> {
  const res = await fetch(`/api/room/${roomId}/rotate?k=${encodeURIComponent(secret)}`, { method: 'POST' })
  if (!res.ok) return null
  const { invite } = await res.json() as { invite: string }
  return invite
}

/** Steward only. The room, its log, its approvals and its keys all go. */
export async function deleteRoom(roomId: string, secret: string): Promise<boolean> {
  const res = await fetch(`/api/room/${roomId}/delete?k=${encodeURIComponent(secret)}`, { method: 'POST' })
  return res.ok
}

export async function roomMeta(roomId: string, secret: string): Promise<{
  role: 'steward' | 'member'; defId: string; title: string; invite?: string
} | null> {
  const res = await fetch(`/api/room/${roomId}/meta?k=${encodeURIComponent(secret)}`)
  if (!res.ok) return null
  return await res.json() as { role: 'steward' | 'member'; defId: string; title: string; invite?: string }
}
