// The room registry. Adding a workplace means adding a file here and nothing
// else: no new components, no engine changes. If a room ever needs its own UI,
// that is the schema being wrong rather than the room being special.

import type { RoomDefinition } from '../types.js'
import { campaign } from './campaign.js'
import { classroom } from './classroom.js'
import { support } from './support.js'
import { shop } from './shop.js'

const ALL = [campaign, classroom, support, shop]

export const ROOMS: Record<string, RoomDefinition> =
  Object.fromEntries(ALL.map(r => [r.id, r]))

export const DEFAULT_ROOM = campaign.id

export function roomById(id: string | null | undefined): RoomDefinition {
  return (id && ROOMS[id]) || campaign
}

export function roomList(): RoomDefinition[] {
  return ALL
}
