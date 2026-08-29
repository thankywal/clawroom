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
  const named = items.find(i => loose(i.id) === key)
    ?? items.find(i => loose(i.title) === key)
    ?? items.find(i => loose(i.title).includes(key) || key.includes(loose(i.title)))
  if (named) return named

  // Models guess ordinals constantly. Asked to work on the first thing on a
  // board whose items are w_1 and w_2, they will pass post_1 or item 1 or #1
  // with total confidence. If a reference is some word and a number, and the
  // board has that many items, they mean the nth one.
  const ordinal = /^[a-z_#\s]*?(\d{1,2})$/.exec(raw.toLowerCase().trim())
  const n = ordinal?.[1] ? Number(ordinal[1]) : 0
  return n >= 1 && n <= items.length ? items[n - 1] : undefined
}
