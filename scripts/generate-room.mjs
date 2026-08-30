#!/usr/bin/env node
// An OpenAPI 3 document in, a ClawRoom room out.
//
// Every operation becomes a tool with a tier chosen from its method and its
// name: reads are work tier, writes are share tier, and anything that sounds
// irreversible (delete, refund, publish, pay, ship...) is commit tier and will
// park for a person. An `x-clawroom-tier` on the operation overrides the guess.
//
//   node scripts/generate-room.mjs docs/examples/orders-openapi.json \
//     --id orders --title "Order desk" --steward "Desk lead" --member "Packer"
//
// The generated file is a real room: register it in src/rooms/index.ts and it
// shows up in the switcher, its tools register over WebMCP, its commit-tier
// calls park, its log fills. Until BASE is set in that file every call is a
// dry run that still obeys the tiers, which is the point of generating the
// room before wiring the API rather than after.

import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
if (!file) {
  console.error('usage: node scripts/generate-room.mjs <openapi.json> [--id x] [--title t] [--steward role] [--member role] [--out path]')
  process.exit(2)
}

const spec = JSON.parse(readFileSync(file, 'utf8'))
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const id = slug(opt('id', spec.info?.title ?? 'api')).replace(/_/g, '-')
const ident = id.replace(/-/g, '_')
const title = opt('title', spec.info?.title ?? id)
const stewardRole = opt('steward', 'Lead')
const memberRole = opt('member', 'Operator')
const out = opt('out', `src/rooms/${id}.ts`)
const premise = opt('premise', spec.info?.description?.split(/(?<=\.)\s/)[0] ?? `A room generated from ${title}.`)

const IRREVERSIBLE = /(publish|send|pay|charge|refund|delete|cancel|ship|deploy|release|approve|transfer|destroy)/i

function deref(s, depth = 0) {
  if (!s || depth > 6) return s
  if (s.$ref) {
    let cur = spec
    for (const k of s.$ref.replace(/^#\//, '').split('/')) cur = cur?.[k]
    return deref(cur, depth + 1) ?? { type: 'object' }
  }
  return s
}
function clean(s, depth = 0) {
  s = deref(s)
  if (!s || typeof s !== 'object' || depth > 6) return { type: 'string' }
  const o = {}
  for (const k of ['type', 'description', 'enum', 'format', 'minimum', 'maximum', 'default']) if (s[k] !== undefined) o[k] = s[k]
  if (s.properties) o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, clean(v, depth + 1)]))
  if (s.required) o.required = s.required
  if (s.items) o.items = clean(s.items, depth + 1)
  if (!o.type) o.type = o.properties ? 'object' : 'string'
  return o
}
function tierFor(method, op) {
  const forced = op['x-clawroom-tier']
  if (forced === 'work' || forced === 'share' || forced === 'commit') return forced
  if (method === 'get' || method === 'head') return 'work'
  if (method === 'delete') return 'commit'
  if (IRREVERSIBLE.test(`${op.operationId ?? ''} ${op.summary ?? ''}`)) return 'commit'
  return 'share'
}
function schemaFor(op, pathItem) {
  const props = {}
  const required = new Set()
  for (const raw of [...(pathItem.parameters ?? []), ...(op.parameters ?? [])]) {
    const p = deref(raw)
    props[p.name] = { ...clean(p.schema), ...(p.description ? { description: p.description } : {}) }
    if (p.required) required.add(p.name)
  }
  const body = deref(op.requestBody?.content?.['application/json']?.schema)
  if (body?.properties) {
    for (const [k, v] of Object.entries(body.properties)) props[k] = clean(v)
    for (const r of body.required ?? []) required.add(r)
  }
  return { type: 'object', properties: props, required: [...required], additionalProperties: false }
}
const toolName = (method, path, op) => op.operationId
  ? slug(op.operationId.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))
  : slug(`${method}_${path.replace(/[{}]/g, '')}`)

const tools = []
for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head']) {
    const op = pathItem[method]
    if (!op) continue
    const tier = tierFor(method, op)
    const name = toolName(method, path, op)
    const what = op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`
    const rule = tier === 'work'
      ? 'Reads only. What comes back stays on this machine; the room learns that you looked.'
      : tier === 'share'
        ? 'Writes. The result lands on the shared board where everyone in the room sees it.'
        : `Irreversible. This parks until the ${stewardRole} approves it, and nothing happens before then.`
    tools.push({ name, tier, method: method.toUpperCase(), path, description: `${what}. ${method.toUpperCase()} ${path}. ${rule}`, inputSchema: schemaFor(op, pathItem) })
  }
}
if (!tools.length) { console.error('no operations found under paths'); process.exit(1) }

const q = s => JSON.stringify(s)
const toolSrc = t => `  {
    name: ${q(t.name)},
    description:
      ${q(t.description)},
    tier: ${q(t.tier)},${t.tier === 'work' ? '\n    readOnly: true,' : ''}
    inputSchema: ${JSON.stringify(t.inputSchema, null, 2).split('\n').join('\n    ')},
    run: (ctx, args) => call(ctx, ${q(t.method)}, ${q(t.path)}, args, ${q(t.tier)}),
  },`

const src = `// ${title}. Generated from ${file} by scripts/generate-room.mjs on ${new Date().toISOString().slice(0, 10)}.
//
// ${tools.length} operations became ${tools.length} tools. Tiers were chosen from each
// operation's method and name (${tools.filter(t => t.tier === 'work').length} work, ${tools.filter(t => t.tier === 'share').length} share, ${tools.filter(t => t.tier === 'commit').length} commit); put
// "x-clawroom-tier" on an operation to choose by hand and regenerate.
//
// Set BASE below and the tools call the real API. Leave it empty and every
// call is a dry run that still obeys the tiers, fills the log, and parks the
// commit-tier ones for a person, which is the whole room working before a
// single request has left the browser.

import type { Person, RoomDefinition, RoomTool, ToolContext, ToolOutcome, WorkItem } from '../types.js'

const BASE = ''

async function call(ctx: ToolContext, method: string, path: string, args: Record<string, any>, tier: 'work' | 'share' | 'commit'): Promise<ToolOutcome> {
  const url = path.replace(/\\{(\\w+)\\}/g, (_m, k: string) => encodeURIComponent(String(args[k] ?? '')))
  const line = \`\${method} \${url}\`
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) if (!path.includes(\`{\${k}}\`)) body[k] = v
  const verb = tier === 'commit' ? 'applied' : 'shared'
  const record = (extra: Record<string, unknown>): void => {
    const item: WorkItem = {
      id: \`\${line.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_\${ctx.room.items.length + 1}\`,
      title: line,
      state: tier === 'commit' ? 'done' : 'review',
      owner: ctx.me.id,
      body: { method, path: url, args: body, ...extra },
    }
    ctx.put(item)
  }
  if (tier === 'commit' && !ctx.approved) {
    return { text: \`Would \${line} with \${JSON.stringify(body)}.\`, summary: \`asked to \${line}\` }
  }
  if (!BASE) {
    if (tier === 'work') {
      ctx.scratch.set(\`call:\${Date.now()}\`, { line, args })
      return { text: \`Dry run of \${line}. Set BASE in this room's file to make it real.\`, summary: \`called \${line}\` }
    }
    record({ dryRun: true })
    return { text: \`\${verb[0]!.toUpperCase()}\${verb.slice(1)} \${line} (dry run) on the board.\`, summary: \`\${verb} \${line}\` }
  }
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? null : JSON.stringify(body),
  })
  const text = (await res.text()).slice(0, 4000)
  if (tier !== 'work') record({ status: res.status })
  return { text: \`HTTP \${res.status}\\n\${text}\`, summary: \`\${tier === 'work' ? 'called' : verb} \${line} (HTTP \${res.status})\` }
}

const memberTools: RoomTool[] = [
${tools.map(toolSrc).join('\n')}
]

export const ${ident}: RoomDefinition = {
  id: ${q(id)},
  title: ${q(title)},
  premise: ${q(premise)},
  stewardRole: ${q(stewardRole)},
  memberRole: ${q(memberRole)},
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
          const k = \`\${e.actor}|\${e.tool}\`
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
        for (const [k, n] of counts) {
          if (n < 4) continue
          const [actor, tool] = k.split('|')
          const who = room.members.find(m => m.id === actor)?.name ?? 'Someone'
          return \`\${who} has called \${tool} \${n} times in the last thirty calls. Something is not working for them.\`
        }
        return null
      },
    },
  ],
  seed: (_people: Person[]): WorkItem[] => [],
}
`
writeFileSync(out, src)
console.log(`${out}: ${tools.length} tools (${tools.map(t => `${t.name}:${t.tier}`).join(', ')})`)
console.log(`register it: import { ${ident} } from './${id}.js' in src/rooms/index.ts and add it to ALL`)
