// Finding the thing an agent meant.
//
// Models do not reliably echo an id back. Asked to work on "the landing page
// copy" against an item called w_1 they will confidently pass
// landing_page_copy, and a room that answers "no such item" to that is being
// pedantic rather than correct. So a reference resolves by id, then by title,
// then by a loose match on either.

import type { WorkItem } from '../types.js'

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

export function findItem(items: readonly WorkItem[], ref: unknown): WorkItem | undefined {
  const raw = String(ref ?? '').trim()
  if (!raw) return undefined
  const exact = items.find(i => i.id === raw)
  if (exact) return exact
  const key = loose(raw)
  if (!key) return undefined
  return items.find(i => loose(i.id) === key)
    ?? items.find(i => loose(i.title) === key)
    ?? items.find(i => loose(i.title).includes(key) || key.includes(loose(i.title)))
}
