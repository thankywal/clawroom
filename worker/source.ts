// Borrowing tools from somewhere else.
//
// A room's own tools are written in TypeScript and shipped with the site. A
// source is the other way in: point the room at an OpenAPI document or a
// remote MCP server, and its operations become room tools, tiered by the same
// three rules everything else obeys. Reads are work tier, writes are share
// tier, and anything that sounds irreversible is commit tier and waits for a
// person.
//
// Two things the browser cannot do itself, and this file exists for both.
// It cannot fetch a description from another origin, because of CORS, and it
// should not be the thing that decides which hosts are safe to call. So the
// Worker fetches, parses, refuses the addresses that have no business being
// called from a server, and proxies the calls the tools make.
//
// What it is not is a tool registry. Nothing is stored here. The parsed source
// goes back to the browser, lands in the room's shared state after a person
// approves it, and reaches the Worker again on every call.

import { handleDemoApi } from './demo-api.js'

const INSPECT_MS = 12_000
const CALL_MS = 20_000
const MAX_BODY = 24_000
const MAX_TOOLS = 40

/** Anything that sounds like it cannot be taken back. */
const IRREVERSIBLE = /(publish|send|pay|charge|refund|delete|cancel|ship|deploy|release|approve|transfer|destroy|remove|purchase|order)/i

const json = (b: unknown, status = 200): Response =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

/**
 * The Worker will fetch a URL a person typed, so it has to refuse the ones
 * that only make sense as an attack: another service on the same private
 * network, the loopback address, and the cloud metadata endpoint. This is a
 * name and literal check rather than a resolved address check, which stops
 * the obvious cases and not a hostname that resolves to a private address on
 * purpose. LIMITS.md says so.
 */
function allowedUrl(raw: string): URL | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return null
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return null
  if (/^(127\.|10\.|0\.|192\.168\.|169\.254\.)/.test(h)) return null
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null
  if (h === '::1' || h.startsWith('[')) return null
  return u
}

/**
 * A Worker cannot fetch its own hostname: Cloudflare answers 1042 rather than
 * looping back in. The fixture API lives on this same worker, so a URL that
 * points at it is dispatched in process instead of over the network. Every
 * other address goes out through fetch as normal.
 */
async function fetchAny(target: string, init: RequestInit, self: string): Promise<Response> {
  const u = new URL(target)
  if (u.origin === self && u.pathname.startsWith('/api/demo')) {
    return await handleDemoApi(new Request(target, init), u.pathname.slice('/api/demo'.length))
  }
  return await fetch(target, init)
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('that took too long')), ms)),
  ])
}

/** Streamable HTTP MCP answers either as JSON or as one SSE frame. */
function readMcpBody(text: string): any {
  const t = text.trim()
  if (t.startsWith('{')) { try { return JSON.parse(t) } catch { return null } }
  for (const line of t.split('\n')) {
    if (!line.startsWith('data:')) continue
    try { return JSON.parse(line.slice(5).trim()) } catch { /* next frame */ }
  }
  return null
}

async function mcpCall(endpoint: string, method: string, params: unknown, id: number): Promise<any> {
  const res = await withTimeout(fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }), INSPECT_MS)
  if (!res.ok) throw new Error(`${method} answered HTTP ${res.status}`)
  const body = readMcpBody(await res.text())
  if (body?.error) throw new Error(String(body.error?.message ?? 'the server refused'))
  return body?.result ?? null
}

interface ParsedTool {
  name: string
  description: string
  tier: 'work' | 'share' | 'commit'
  inputSchema: Record<string, unknown>
  method?: string
  path?: string
  remote?: string
}

const slug = (s: string) =>
  String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)

function tierFor(method: string, name: string, summary: string, forced?: unknown): 'work' | 'share' | 'commit' {
  if (forced === 'work' || forced === 'share' || forced === 'commit') return forced
  const m = method.toLowerCase()
  if (m === 'get' || m === 'head') return 'work'
  if (m === 'delete') return 'commit'
  if (IRREVERSIBLE.test(`${name} ${summary}`)) return 'commit'
  return 'share'
}

// ---------- OpenAPI ----------

function parseOpenApi(spec: any, docUrl: URL): { name: string; base: string; tools: ParsedTool[] } {
  const deref = (s: any, depth = 0): any => {
    if (!s || typeof s !== 'object' || depth > 6) return s
    if (typeof s.$ref === 'string') {
      let cur: any = spec
      for (const k of s.$ref.replace(/^#\//, '').split('/')) cur = cur?.[k]
      return deref(cur, depth + 1) ?? { type: 'object' }
    }
    return s
  }
  const clean = (s: any, depth = 0): Record<string, unknown> => {
    s = deref(s)
    if (!s || typeof s !== 'object' || depth > 5) return { type: 'string' }
    const o: Record<string, unknown> = {}
    for (const k of ['type', 'description', 'enum', 'format', 'default']) if (s[k] !== undefined) o[k] = s[k]
    if (s.properties) {
      o['properties'] = Object.fromEntries(
        Object.entries(s.properties).slice(0, 25).map(([k, v]) => [k, clean(v, depth + 1)]),
      )
    }
    if (Array.isArray(s.required)) o['required'] = s.required
    if (s.items) o['items'] = clean(s.items, depth + 1)
    if (!o['type']) o['type'] = o['properties'] ? 'object' : 'string'
    return o
  }

  const serverRaw = String(spec?.servers?.[0]?.url ?? '')
  let base = serverRaw
  if (!/^https?:\/\//.test(base)) base = new URL(base || '/', docUrl).toString().replace(/\/$/, '')
  base = base.replace(/\/$/, '')

  const tools: ParsedTool[] = []
  for (const [path, item] of Object.entries<any>(spec?.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item?.[method]
      if (!op || tools.length >= MAX_TOOLS) continue
      const name = slug(op.operationId ?? `${method}_${path.replace(/[{}]/g, '')}`)
      if (!name) continue
      const summary = String(op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`)
      const tier = tierFor(method, name, summary, op['x-clawroom-tier'])

      const props: Record<string, unknown> = {}
      const required: string[] = []
      for (const raw of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const p = deref(raw)
        if (!p?.name) continue
        props[p.name] = { ...clean(p.schema), ...(p.description ? { description: p.description } : {}) }
        if (p.required) required.push(p.name)
      }
      const body = deref(op.requestBody?.content?.['application/json']?.schema)
      if (body?.properties) {
        for (const [k, v] of Object.entries(body.properties).slice(0, 25)) props[k] = clean(v)
        for (const r of body.required ?? []) required.push(r)
      }

      const rule = tier === 'work'
        ? 'Reads only. What comes back stays on this machine; the room learns that you looked.'
        : tier === 'share'
          ? 'Writes. What happens lands on the shared board where everyone in the room sees it.'
          : 'Irreversible. This parks until a person in this room approves it, and nothing happens before then.'
      tools.push({
        name,
        description: `${summary}. ${method.toUpperCase()} ${path}. ${rule}`,
        tier,
        inputSchema: { type: 'object', properties: props, required: [...new Set(required)] },
        method: method.toUpperCase(),
        path,
      })
    }
  }
  return { name: String(spec?.info?.title ?? docUrl.hostname), base, tools }
}

// ---------- what is at this URL ----------

const OPENAPI_PATHS = ['', '/openapi.json', '/openapi.yaml', '/swagger.json', '/api-docs', '/.well-known/openapi.json']
const MCP_PATHS = ['', '/mcp', '/api/mcp']

async function tryOpenApi(u: URL, self: string): Promise<{ spec: any; at: URL } | null> {
  for (const p of OPENAPI_PATHS) {
    const at = p ? new URL(u.pathname.replace(/\/$/, '') + p, u) : u
    try {
      const res = await withTimeout(fetchAny(at.toString(), { headers: { accept: 'application/json' } }, self), INSPECT_MS)
      if (!res.ok) continue
      const text = (await res.text()).slice(0, 900_000)
      const spec = JSON.parse(text)
      if (spec?.openapi || spec?.swagger) return { spec, at }
    } catch { /* the next candidate */ }
  }
  return null
}

async function tryMcp(u: URL): Promise<{ endpoint: string; tools: any[]; name: string } | null> {
  for (const p of MCP_PATHS) {
    const at = p ? new URL(u.pathname.replace(/\/$/, '') + p, u).toString() : u.toString()
    try {
      const init = await mcpCall(at, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'clawroom', version: '1.0.0' },
      }, 1)
      const listed = await mcpCall(at, 'tools/list', {}, 2)
      const tools = Array.isArray(listed?.tools) ? listed.tools : []
      if (!tools.length) continue
      return { endpoint: at, tools, name: String(init?.serverInfo?.name ?? u.hostname) }
    } catch { /* the next candidate */ }
  }
  return null
}

/** A page that registers its own WebMCP tools. We can see that it does, and
 *  we cannot call them, because a document's tool surface belongs to that
 *  document. Saying so plainly is better than pretending. */
async function tryWebMcpPage(u: URL): Promise<{ title: string } | null> {
  try {
    const res = await withTimeout(fetch(u.toString(), { headers: { accept: 'text/html' } }), INSPECT_MS)
    if (!res.ok) return null
    const html = (await res.text()).slice(0, 400_000)
    if (!/modelContext|registerTool|web[-_]?mcp/i.test(html)) return null
    return { title: (html.match(/<title[^>]*>([^<]{1,90})/i)?.[1] ?? u.hostname).trim() }
  } catch { return null }
}

// ---------- the endpoint ----------

export async function handleSource(req: Request, env: Env, roomId: string): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const self = new URL(req.url).origin
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad JSON' }, 400) }

  // Holding a key to this room is what gets you in. It is not an authorisation
  // check on the target: the address guard above is what keeps this from
  // becoming an open proxy into somebody's private network.
  const meta = await env.ROOM.get(env.ROOM.idFromName(roomId))
    .fetch(new Request(`https://room/meta?k=${encodeURIComponent(String(body?.k ?? ''))}`))
  if (!meta.ok) return json({ error: 'not your room' }, 403)

  if (body?.op === 'call') return await proxyCall(body, self)

  const u = allowedUrl(String(body?.url ?? ''))
  if (!u) return json({ error: 'That address cannot be reached from here. Public http or https only.' }, 400)

  const mcp = await tryMcp(u)
  if (mcp) {
    const tools: ParsedTool[] = mcp.tools.slice(0, MAX_TOOLS).map((t: any) => {
      const name = slug(t.name)
      const summary = String(t.description ?? t.name)
      const readOnly = t.annotations?.readOnlyHint === true
      const destructive = t.annotations?.destructiveHint === true
      // MCP tools are all POSTs, so the verb says nothing. Most servers do not
      // set the hints either, so fall back to the name: a tool called
      // read_wiki_contents is a read whatever the transport looks like.
      const reads = /^(read|get|list|search|find|ask|query|fetch|lookup|show|describe)_/.test(name + '_')
      const tier = readOnly ? 'work' : destructive ? 'commit' : reads ? 'work' : tierFor('post', name, summary)
      const rule = tier === 'work'
        ? 'Reads only. What comes back stays on this machine.'
        : tier === 'share'
          ? 'Writes. The result lands on the shared board.'
          : 'Irreversible. This parks until a person in this room approves it.'
      return {
        name,
        description: `${summary} ${rule}`,
        tier,
        inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        remote: String(t.name),
      }
    })
    return json({ kind: 'mcp', name: mcp.name, url: u.toString(), base: mcp.endpoint, tools })
  }

  const api = await tryOpenApi(u, self)
  if (api) {
    const parsed = parseOpenApi(api.spec, api.at)
    if (!parsed.tools.length) return json({ error: 'That OpenAPI document has no operations we can call.' }, 422)
    return json({ kind: 'openapi', name: parsed.name, url: api.at.toString(), base: parsed.base, tools: parsed.tools })
  }

  const page = await tryWebMcpPage(u)
  if (page) {
    return json({
      kind: 'webmcp',
      name: page.title,
      url: u.toString(),
      base: u.origin,
      tools: [],
      note:
        'This page registers its own WebMCP tools, and they belong to that page. ' +
        'A tool surface lives in one document, so this room cannot call them from here: ' +
        'an agent has to be on that page. Added as a link the room can see.',
    })
  }

  return json({
    error:
      'Nothing callable found there. Give an OpenAPI document, or the URL of a remote MCP server, ' +
      'or a page that registers WebMCP tools.',
  }, 422)
}

async function proxyCall(body: any, self: string): Promise<Response> {
  const kind = String(body?.kind ?? '')
  const args = (body?.args ?? {}) as Record<string, unknown>

  if (kind === 'mcp') {
    const u = allowedUrl(String(body?.base ?? ''))
    if (!u) return json({ error: 'that endpoint cannot be reached from here' }, 400)
    try {
      const out = await withTimeout(mcpCall(u.toString(), 'tools/call', {
        name: String(body?.remote ?? ''), arguments: args,
      }, 3), CALL_MS)
      const text = Array.isArray(out?.content)
        ? out.content.map((c: any) => c?.text ?? '').join('\n').slice(0, MAX_BODY)
        : JSON.stringify(out ?? {}).slice(0, MAX_BODY)
      return json({ ok: !out?.isError, status: out?.isError ? 500 : 200, text })
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e) }, 502)
    }
  }

  // openapi
  const method = String(body?.method ?? 'GET').toUpperCase()
  const path = String(body?.path ?? '')
  const filled = path.replace(/\{(\w+)\}/g, (_m, k: string) => encodeURIComponent(String(args[k] ?? '')))
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) if (!path.includes(`{${k}}`)) rest[k] = v

  const target = allowedUrl(String(body?.base ?? '').replace(/\/$/, '') + filled)
  if (!target) return json({ error: 'that address cannot be reached from here' }, 400)

  if (method === 'GET' || method === 'HEAD') {
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== null && v !== '') target.searchParams.set(k, String(v))
    }
  }
  try {
    const res = await withTimeout(fetchAny(target.toString(), {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/plain' },
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(rest) }),
    }, self), CALL_MS)
    const text = (await res.text()).slice(0, MAX_BODY)
    return json({ ok: res.ok, status: res.status, text })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502)
  }
}
