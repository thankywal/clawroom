// A shop floor.
//
// Staff help customers with their own agents. The interesting signal is not
// what sold, it is what people kept looking for and could not find, which is
// a number no till ever reports.

import type { Person, RoomDefinition, RoomTool, WorkItem } from '../types.js'
import { findItem } from '../engine/find.js'

interface LineBody { customer: string; want: string; picked: string }
const body = (i: WorkItem) => i.body as unknown as LineBody

const STOCK: Record<string, number> = {
  'oat milk': 0,
  'rye flour': 12,
  'green tea': 40,
  'olive oil': 3,
  'chilli oil': 0,
}

const memberTools: RoomTool[] = [
  {
    name: 'list_requests',
    description: 'List the customers currently being helped and what each of them is after.',
    tier: 'work',
    readOnly: true,
    untrusted: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => ({
      text: ctx.room.items.map(i => `${i.id} [${i.state}] ${body(i).customer} wants ${body(i).want}`).join('\n')
        || 'Nobody waiting.',
      summary: `read ${ctx.room.items.length} requests`,
    }),
  },
  {
    name: 'check_stock',
    description: 'Check how many of something is on the shelf. Searching costs nothing and is not a commitment.',
    tier: 'work',
    inputSchema: {
      type: 'object',
      properties: { item: { type: 'string', description: 'What to look for, for example oat milk' } },
      required: ['item'],
    },
    run: (ctx, args) => {
      const want = String(args['item']).toLowerCase().trim()
      const n = STOCK[want]
      ctx.scratch.set(`looked:${want}`, Date.now())
      return {
        text: n === undefined ? `We do not carry ${want}.` : n === 0 ? `${want}: none left.` : `${want}: ${n} on the shelf.`,
        data: { item: want, count: n ?? 0 },
        summary: n ? `found ${want}` : `looked for ${want}, none`,
      }
    },
  },
  {
    name: 'reserve',
    description: 'Hold something behind the counter for a customer, so the floor knows it is spoken for.',
    tier: 'share',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' }, item: { type: 'string' } },
      required: ['itemId', 'item'],
    },
    run: (ctx, args) => {
      const line = findItem(ctx.room.items, args['itemId'])
      if (!line) return { text: `No request called ${String(args['itemId'])}.` }
      ctx.put({ ...line, state: 'review', owner: ctx.me.id, body: { ...body(line), picked: String(args['item']) } })
      return { text: `Holding ${String(args['item'])} for ${body(line).customer}.`, summary: `held ${String(args['item'])} for ${body(line).customer}` }
    },
  },
  {
    name: 'apply_discount',
    description: 'Take money off a sale. The owner decides, not the floor.',
    tier: 'commit',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' }, percent: { type: 'number' } },
      required: ['itemId', 'percent'],
    },
    run: (ctx, args) => {
      const line = findItem(ctx.room.items, args['itemId'])
      if (!line) return { text: `No request called ${String(args['itemId'])}.` }
      const pct = Number(args['percent'] ?? 0)
      if (!ctx.approved) {
        return { text: `take ${pct}% off for ${body(line).customer}`, summary: `${pct}% off for ${body(line).customer}` }
      }
      ctx.put({ ...line, state: 'done' })
      return { text: `Applied ${pct}%.`, summary: `applied ${pct}% off for ${body(line).customer}` }
    },
  },
]

export const shop: RoomDefinition = {
  id: 'shop',
  title: 'Saturday shop floor',
  premise: 'Staff helping customers on the floor, each with their own agent.',
  stewardRole: 'shop owner',
  memberRole: 'shop assistant',
  memberTools,
  stewardTools: [],
  signals: [
    {
      id: 'missed-demand',
      label: 'Demand you are not seeing',
      detect: (events) => {
        const misses = new Map<string, number>()
        for (const e of events) {
          const m = /looked for (.+), none/.exec(e.summary)
          if (m?.[1]) misses.set(m[1], (misses.get(m[1]) ?? 0) + 1)
        }
        for (const [item, n] of misses) {
          if (n >= 2) return `${n} customers asked for ${item} today and left without it.`
        }
        return null
      },
    },
  ],
  seed: (_people: Person[]): WorkItem[] => [
    { id: 'c_1', title: 'Customer at the counter', state: 'open', body: { customer: 'Aung', want: 'oat milk and rye flour', picked: '' } },
    { id: 'c_2', title: 'Customer by the shelves', state: 'open', body: { customer: 'Thiri', want: 'something for a gift', picked: '' } },
    { id: 'c_3', title: 'Phone order', state: 'open', body: { customer: 'Harbour Cafe', want: 'chilli oil, a case', picked: '' } },
  ],
}
