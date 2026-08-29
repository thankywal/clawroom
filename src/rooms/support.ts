// A support desk.
//
// The signal here is the one that pays for the room. When four different
// people's agents run the same diagnostic and it fails every time, that is not
// four support tickets, it is one product bug, and nobody currently sees it
// because each conversation happens in a different window.

import type { Person, RoomDefinition, RoomTool, WorkItem } from '../types.js'
import { findItem } from '../engine/find.js'

interface TicketBody { customer: string; problem: string; reply: string }
const body = (i: WorkItem) => i.body as unknown as TicketBody

const DIAGNOSTICS: Record<string, string> = {
  connectivity: 'FAILED: the account region is set to eu-west but the workspace is us-east',
  billing: 'PASSED: the card on file is valid and the last charge settled',
  export: 'FAILED: the account region is set to eu-west but the workspace is us-east',
}

const memberTools: RoomTool[] = [
  {
    name: 'get_tickets',
    description: 'List the open tickets on this desk with their customer and problem.',
    tier: 'work',
    readOnly: true,
    untrusted: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => ({
      text: ctx.room.items.map(i => `${i.id} [${i.state}] ${body(i).customer}: ${body(i).problem}`).join('\n')
        || 'No open tickets.',
      summary: `read ${ctx.room.items.length} tickets`,
    }),
  },
  {
    name: 'run_diagnostic',
    description:
      'Run a diagnostic against a customer account. Choose connectivity, billing or export. ' +
      'The output stays on this machine; the desk records that you ran it and whether it passed.',
    tier: 'work',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        check: { type: 'string', description: 'connectivity, billing or export' },
      },
      required: ['itemId', 'check'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No ticket called ${String(args['itemId'])}.` }
      const check = String(args['check'])
      const out = DIAGNOSTICS[check] ?? `No diagnostic called ${check}.`
      ctx.scratch.set(`diag:${item.id}:${check}`, out)
      const failed = out.startsWith('FAILED')
      return {
        text: out,
        data: { check, passed: !failed },
        summary: `ran ${check} on ${item.id}, ${failed ? 'failed' : 'passed'}`,
      }
    },
  },
  {
    name: 'reply_to_customer',
    description: 'Put a reply on the ticket so the desk can see what the customer was told.',
    tier: 'share',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' }, reply: { type: 'string' } },
      required: ['itemId', 'reply'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No ticket called ${String(args['itemId'])}.` }
      ctx.put({ ...item, state: 'review', owner: ctx.me.id, body: { ...body(item), reply: String(args['reply']) } })
      return { text: `Replied on ${item.id}.`, summary: `replied on ${item.id}` }
    },
  },
  {
    name: 'issue_refund',
    description: 'Refund a customer. Money leaves the company, so a human decides.',
    tier: 'commit',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' }, amount: { type: 'number' } },
      required: ['itemId', 'amount'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No ticket called ${String(args['itemId'])}.` }
      const amount = Number(args['amount'] ?? 0)
      if (!ctx.approved) {
        return { text: `refund ${body(item).customer} $${amount}`, summary: `refund ${body(item).customer} $${amount}` }
      }
      ctx.put({ ...item, state: 'done' })
      return { text: `Refunded $${amount}.`, summary: `refunded ${body(item).customer} $${amount}` }
    },
  },
]

export const support: RoomDefinition = {
  id: 'support',
  title: 'Tuesday support desk',
  premise: 'A support team working tickets, each person with their own agent.',
  stewardRole: 'support lead',
  memberRole: 'support rep',
  memberTools,
  stewardTools: [],
  signals: [
    {
      id: 'product-bug',
      label: 'This is not a support problem',
      detect: (events) => {
        const failed = events.filter(e => e.tool === 'run_diagnostic' && /failed/.test(e.summary))
        const byCheck = new Map<string, number>()
        for (const e of failed) {
          const m = /ran (\w+)/.exec(e.summary)
          if (m?.[1]) byCheck.set(m[1], (byCheck.get(m[1]) ?? 0) + 1)
        }
        for (const [check, n] of byCheck) {
          if (n >= 3) return `${check} has failed ${n} times across different tickets. That is a bug, not a queue.`
        }
        return null
      },
    },
  ],
  seed: (_people: Person[]): WorkItem[] => [
    { id: 't_401', title: 'Ticket 401', state: 'open', body: { customer: 'Harbour Foods', problem: 'Exports time out every morning', reply: '' } },
    { id: 't_402', title: 'Ticket 402', state: 'open', body: { customer: 'Bell & Co', problem: 'Cannot connect from the new office', reply: '' } },
    { id: 't_403', title: 'Ticket 403', state: 'open', body: { customer: 'Atlas Studio', problem: 'Charged twice in August', reply: '' } },
  ],
}
