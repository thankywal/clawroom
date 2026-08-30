// A small API that exists so the tool-source feature has something honest to
// point at.
//
// Judges need a URL they can paste that works on the first try, and the public
// sample APIs are either down (the Swagger petstore was returning 500 the day
// this was written) or need a key. So the site serves one: an order desk with
// four operations, one of which is a refund, because a refund is the clearest
// example of a call that should never happen without a person saying yes.
//
// It is a fixture, and the description says so. State lives in the isolate and
// is lost when Cloudflare recycles it. Nothing here is part of the room engine.

const ORDERS: Record<string, { id: string; customer: string; total: number; state: string; notes: string[] }> = {}

function seed(): void {
  if (Object.keys(ORDERS).length) return
  const rows = [
    { id: 'HF-1041', customer: 'Harbour Foods', total: 248.5, state: 'packed' },
    { id: 'HF-1042', customer: 'Bright Cafe', total: 96, state: 'open' },
    { id: 'HF-1043', customer: 'Rowan Bakery', total: 415.25, state: 'shipped' },
  ]
  for (const r of rows) ORDERS[r.id] = { ...r, notes: [] }
}

const json = (b: unknown, status = 200): Response =>
  new Response(JSON.stringify(b, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })

const SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Harbour Foods order desk',
    version: '1.0.0',
    description:
      'A worked example for ClawRoom tool sources. Four operations: two reads, one note, one refund. ' +
      'State is in memory and resets when the worker recycles.',
  },
  servers: [{ url: '/api/demo' }],
  paths: {
    '/orders': {
      get: { operationId: 'listOrders', summary: 'List the orders on the desk' },
    },
    '/orders/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The order number, for example HF-1041' }],
      get: { operationId: 'getOrder', summary: 'Read one order with its notes' },
    },
    '/orders/{id}/notes': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        operationId: 'addNote',
        summary: 'Add a note the whole desk can see',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            },
          },
        },
      },
    },
    '/orders/{id}/refund': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        operationId: 'refundOrder',
        summary: "Refund an order to the customer's card",
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  amount: { type: 'number', description: 'In pounds' },
                  reason: { type: 'string' },
                },
                required: ['amount', 'reason'],
              },
            },
          },
        },
      },
    },
  },
}

export async function handleDemoApi(req: Request, path: string): Promise<Response> {
  seed()
  if (path === '/openapi.json' || path === '' || path === '/') return json(SPEC)

  const list = path === '/orders'
  if (list && req.method === 'GET') return json({ orders: Object.values(ORDERS) })

  const m = path.match(/^\/orders\/([A-Za-z0-9-]{1,20})(\/notes|\/refund)?$/)
  if (!m) return json({ error: 'no such endpoint on this fixture' }, 404)
  const order = ORDERS[m[1]!.toUpperCase()]
  if (!order) return json({ error: 'no such order' }, 404)

  if (!m[2] && req.method === 'GET') return json(order)

  let body: any = {}
  try { body = await req.json() } catch { /* an empty body is its own error below */ }

  if (m[2] === '/notes' && req.method === 'POST') {
    const text = String(body?.text ?? '').slice(0, 500)
    if (!text) return json({ error: 'a note needs text' }, 400)
    order.notes.push(text)
    return json({ ok: true, id: order.id, notes: order.notes })
  }

  if (m[2] === '/refund' && req.method === 'POST') {
    const amount = Number(body?.amount)
    const reason = String(body?.reason ?? '').slice(0, 200)
    if (!amount || amount <= 0) return json({ error: 'a refund needs an amount' }, 400)
    if (!reason) return json({ error: 'a refund needs a reason' }, 400)
    if (amount > order.total) return json({ error: `that is more than the order total of ${order.total}` }, 400)
    order.state = 'refunded'
    order.notes.push(`refunded ${amount} because ${reason}`)
    return json({ ok: true, id: order.id, refunded: amount, state: order.state })
  }

  return json({ error: 'wrong method for that endpoint' }, 405)
}
