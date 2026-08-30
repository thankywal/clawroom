// Order desk. Generated from docs/examples/orders-openapi.json by scripts/generate-room.mjs on 2026-08-30.
//
// 6 operations became 6 tools. Tiers were chosen from each
// operation's method and name (2 work, 2 share, 2 commit); put
// "x-clawroom-tier" on an operation to choose by hand and regenerate.
//
// Set BASE below and the tools call the real API. Leave it empty and every
// call is a dry run that still obeys the tiers, fills the log, and parks the
// commit-tier ones for a person, which is the whole room working before a
// single request has left the browser.

import type { Person, RoomDefinition, RoomTool, ToolContext, ToolOutcome, WorkItem } from '../types.js'

const BASE = ''

async function call(ctx: ToolContext, method: string, path: string, args: Record<string, any>, tier: 'work' | 'share' | 'commit'): Promise<ToolOutcome> {
  const url = path.replace(/\{(\w+)\}/g, (_m, k: string) => encodeURIComponent(String(args[k] ?? '')))
  const line = `${method} ${url}`
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) if (!path.includes(`{${k}}`)) body[k] = v
  const verb = tier === 'commit' ? 'applied' : 'shared'
  const record = (extra: Record<string, unknown>): void => {
    const item: WorkItem = {
      id: `${line.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${ctx.room.items.length + 1}`,
      title: line,
      state: tier === 'commit' ? 'done' : 'review',
      owner: ctx.me.id,
      body: { method, path: url, args: body, ...extra },
    }
    ctx.put(item)
  }
  if (tier === 'commit' && !ctx.approved) {
    return { text: `Would ${line} with ${JSON.stringify(body)}.`, summary: `asked to ${line}` }
  }
  if (!BASE) {
    if (tier === 'work') {
      ctx.scratch.set(`call:${Date.now()}`, { line, args })
      return { text: `Dry run of ${line}. Set BASE in this room's file to make it real.`, summary: `called ${line}` }
    }
    record({ dryRun: true })
    return { text: `${verb[0]!.toUpperCase()}${verb.slice(1)} ${line} (dry run) on the board.`, summary: `${verb} ${line}` }
  }
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? null : JSON.stringify(body),
  })
  const text = (await res.text()).slice(0, 4000)
  if (tier !== 'work') record({ status: res.status })
  return { text: `HTTP ${res.status}\n${text}`, summary: `${tier === 'work' ? 'called' : verb} ${line} (HTTP ${res.status})` }
}

const memberTools: RoomTool[] = [
  {
    name: "list_orders",
    description:
      "List open orders. GET /orders. Reads only. What comes back stays on this machine; the room learns that you looked.",
    tier: "work",
    readOnly: true,
    inputSchema: {
      "type": "object",
      "properties": {
        "state": {
          "type": "string",
          "enum": [
            "open",
            "packed",
            "shipped"
          ],
          "description": "Only orders in this state"
        }
      },
      "required": [],
      "additionalProperties": false
    },
    run: (ctx, args) => call(ctx, "GET", "/orders", args, "work"),
  },
  {
    name: "get_order",
    description:
      "Read one order with its lines and address. GET /orders/{id}. Reads only. What comes back stays on this machine; the room learns that you looked.",
    tier: "work",
    readOnly: true,
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "The order number"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    run: (ctx, args) => call(ctx, "GET", "/orders/{id}", args, "work"),
  },
  {
    name: "cancel_order",
    description:
      "Cancel an order and release its stock. DELETE /orders/{id}. Irreversible. This parks until the Desk lead approves it, and nothing happens before then.",
    tier: "commit",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "The order number"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    run: (ctx, args) => call(ctx, "DELETE", "/orders/{id}", args, "commit"),
  },
  {
    name: "add_note",
    description:
      "Add a note the whole desk can see. POST /orders/{id}/notes. Writes. The result lands on the shared board where everyone in the room sees it.",
    tier: "share",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "text": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "text"
      ],
      "additionalProperties": false
    },
    run: (ctx, args) => call(ctx, "POST", "/orders/{id}/notes", args, "share"),
  },
  {
    name: "set_priority",
    description:
      "Move an order up or down the packing queue. POST /orders/{id}/priority. Writes. The result lands on the shared board where everyone in the room sees it.",
    tier: "share",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "level": {
          "type": "string",
          "enum": [
            "low",
            "normal",
            "rush"
          ]
        }
      },
      "required": [
        "id",
        "level"
      ],
      "additionalProperties": false
    },
    run: (ctx, args) => call(ctx, "POST", "/orders/{id}/priority", args, "share"),
  },
  {
    name: "refund_order",
    description:
      "Refund part or all of an order to the customer's card. POST /orders/{id}/refund. Irreversible. This parks until the Desk lead approves it, and nothing happens before then.",
    tier: "commit",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "amount": {
          "type": "number",
          "description": "In the order currency"
        },
        "reason": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "amount",
        "reason"
      ],
      "additionalProperties": false
    },
    run: (ctx, args) => call(ctx, "POST", "/orders/{id}/refund", args, "commit"),
  },
]

export const orders: RoomDefinition = {
  id: "orders",
  title: "Order desk",
  premise: "An order desk generated from an OpenAPI file: reads stay private, writes hit the board, refunds and cancellations wait for the desk lead.",
  stewardRole: "Desk lead",
  memberRole: "Packer",
  memberTools,
  stewardTools: [],
  signals: [
    {
      id: 'retrying',
      label: 'Retrying',
      detect: (events, room) => {
        const counts = new Map<string, number>()
        for (const e of events.slice(-30)) {
          if (e.kind !== 'agent') continue
          const k = `${e.actor}|${e.tool}`
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
        for (const [k, n] of counts) {
          if (n < 4) continue
          const [actor, tool] = k.split('|')
          const who = room.members.find(m => m.id === actor)?.name ?? 'Someone'
          return `${who} has called ${tool} ${n} times in the last thirty calls. Something is not working for them.`
        }
        return null
      },
    },
  ],
  seed: (_people: Person[]): WorkItem[] => [],
}
