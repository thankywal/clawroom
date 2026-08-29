// Tier enforcement, and the approval mechanic.
//
// The API as shipped in the origin trial has no way for a tool to ask a human
// before it acts, the spec group is designing one in webmcp#165, and an
// execute() promise held open for a person's attention span will time out and
// occupy the page's tool surface while it waits. So a commit-tier tool here
// returns a receipt rather than a result. The approval becomes an object in
// shared state, a human acts on the object, and the agent polls the receipt.
//
// Three tiers, and the difference between them is where the payload lives:
//
//   work    the payload stays in ctx.scratch, in this browser. The room gets
//           a one line summary and nothing else.
//   share   the payload becomes a WorkItem everyone can see.
//   commit  nothing happens at all until a human approves.

import type {
  Approval, Event, Person, RoomDefinition, RoomState, RoomTool, ToolContext,
  ToolOutcome, WorkItem,
} from '../types.js'
import type { RoomStore } from './store.js'
import { scratchFor } from './identity.js'

const shortId = () => Math.random().toString(36).slice(2, 6)

/** Appended to every commit-tier description at registration time, so the
 *  model knows the rule before it calls rather than after. */
export const COMMIT_NOTE =
  ' This is a commit-tier action. It does not take effect when you call it. ' +
  'It returns immediately with a handle and waits for a human in the room to ' +
  'approve. Call it once and do not retry.'

function frozenView(state: RoomState): RoomState {
  return { ...state, items: Object.freeze(state.items.map(i => Object.freeze({ ...i }))) as WorkItem[] }
}

function refuse(): never {
  throw new Error(
    'This tool may not change shared state. Work-tier tools keep their payload ' +
    'in scratch, and commit-tier tools only take effect once a human approves.',
  )
}

function contextFor(a: {
  store: RoomStore
  me: Person
  isSteward: boolean
  writable: boolean
  approved: boolean
  collect: WorkItem[]
}): ToolContext {
  return {
    room: a.writable ? a.store.state : frozenView(a.store.state),
    me: a.me,
    isSteward: a.isSteward,
    approved: a.approved,
    put: a.writable ? (item: WorkItem) => { a.collect.push(item) } : refuse,
    scratch: scratchFor(a.store.roomKey, a.me.id),
  }
}

function logEvent(a: {
  store: RoomStore
  actor: Person
  kind: Event['kind']
  tool: string
  tier: RoomTool['tier']
  item?: string | undefined
  summary: string
}): void {
  const event: Event = {
    at: Date.now(),
    actor: a.actor.id,
    kind: a.kind,
    tool: a.tool,
    tier: a.tier,
    summary: a.summary,
    ...(a.item ? { item: a.item } : {}),
  }
  a.store.dispatch({ k: 'event', event })
}

export function runRoomTool(a: {
  store: RoomStore
  tool: RoomTool
  me: Person
  isSteward: boolean
  args: Record<string, unknown>
}): ToolOutcome {
  const { store, tool, me, isSteward, args } = a
  const commit = tool.tier === 'commit'
  const collect: WorkItem[] = []

  const ctx = contextFor({
    store, me, isSteward,
    writable: tool.tier === 'share',
    approved: false,
    collect,
  })

  const outcome = tool.run(ctx, args)
  const summary = outcome.summary ?? outcome.text
  const item = typeof args['itemId'] === 'string' ? args['itemId'] : undefined

  if (!commit) {
    for (const w of collect) store.dispatch({ k: 'item', item: w })
    logEvent({ store, actor: me, kind: 'agent', tool: tool.name, tier: tool.tier, item, summary })
    return outcome
  }

  const approval: Approval = {
    id: `apv_${shortId()}`,
    requestedBy: me.id,
    tool: tool.name,
    describe: summary,
    at: Date.now(),
    args,
    ...(item ? { item } : {}),
  }
  store.dispatch({ k: 'ask', approval })
  logEvent({
    store, actor: me, kind: 'agent', tool: tool.name, tier: 'commit', item,
    summary: `asked to ${summary}`,
  })

  return {
    text:
      `PENDING APPROVAL. handle=${approval.id}\n` +
      `A human in this room has been asked to approve: "${summary}".\n` +
      'You are NOT blocked. Nothing has happened yet and nothing will until a person decides.\n' +
      `Do not retry this call. Either carry on with other work, call check_approval ` +
      `with handle ${approval.id}, or report back to your human now.`,
    data: { status: 'pending', approvalId: approval.id, tool: tool.name, describe: summary },
    summary: `asked to ${summary}`,
    pending: true,
  }
}

/** Runs in the approver's browser, which is the only place the effect can
 *  happen, which is why Approval carries its args. */
export function settleApproval(a: {
  store: RoomStore
  def: RoomDefinition
  approval: Approval
  by: Person
  ok: boolean
}): void {
  const { store, def, approval, by, ok } = a

  if (!ok) {
    logEvent({
      store, actor: by, kind: 'human', tool: approval.tool, tier: 'commit',
      item: approval.item, summary: `declined: ${approval.describe}`,
    })
    store.dispatch({ k: 'settle', approvalId: approval.id, by: by.id, ok: false })
    return
  }

  const tool = [...def.memberTools, ...def.stewardTools].find(t => t.name === approval.tool)
  if (!tool) {
    logEvent({
      store, actor: by, kind: 'human', tool: approval.tool, tier: 'commit',
      summary: `could not apply ${approval.tool}, no such tool in this room`,
    })
    store.dispatch({ k: 'settle', approvalId: approval.id, by: by.id, ok: false })
    return
  }

  const requester = store.state.members.find(p => p.id === approval.requestedBy) ?? by
  const collect: WorkItem[] = []
  const ctx = contextFor({
    store, me: requester, isSteward: false,
    writable: true, approved: true, collect,
  })

  const outcome = tool.run(ctx, approval.args)
  for (const w of collect) store.dispatch({ k: 'item', item: w })
  logEvent({
    store, actor: by, kind: 'human', tool: tool.name, tier: 'commit',
    item: approval.item, summary: outcome.summary ?? outcome.text,
  })
  store.dispatch({ k: 'settle', approvalId: approval.id, by: by.id, ok: true })
}
