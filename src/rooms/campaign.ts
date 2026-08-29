// A marketing department.
//
// The arc a member's agent walks: read the board, draft privately, revise
// privately, put one version up for review, ask to publish. Only the last two
// steps leave the browser, and only the last one needs a person.
//
// The manager sees "Ella drafted three variants and submitted one". The three
// variants were never theirs to read.

import type { Person, RoomDefinition, RoomTool, WorkItem } from '../types.js'
import { findItem } from '../engine/find.js'
import { callCount } from '../engine/signals.js'

interface PostBody {
  brief: string
  channel: string
  headline: string
  submitted: string
}

const body = (i: WorkItem) => i.body as unknown as PostBody


const memberTools: RoomTool[] = [
  {
    name: 'list_posts',
    description: 'List every post on this campaign board, with its brief, channel and state.',
    tier: 'work',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => {
      const rows = ctx.room.items.map(i =>
        `${i.id} [${i.state}] ${i.title} for ${body(i).channel}: ${body(i).brief}`)
      return {
        text: rows.length ? rows.join('\n') : 'The board is empty.',
        data: { posts: ctx.room.items },
        summary: `read the board, ${rows.length} posts`,
      }
    },
  },
  {
    name: 'draft_post',
    description:
      'Write a draft for one post. The draft stays on this machine. Nobody else in the room ' +
      'sees the words, only that you drafted something. Call it again to write another variant.',
    tier: 'work',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: 'Which post, for example post_1' },
        headline: { type: 'string', description: 'The headline you are proposing' },
        copy: { type: 'string', description: 'The body copy' },
      },
      required: ['itemId', 'headline', 'copy'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No post called ${String(args['itemId'])}.` }
      const key = `draft:${item.id}`
      const prior = (ctx.scratch.get(key) as { headline: string; copy: string }[] | undefined) ?? []
      const next = [...prior, { headline: String(args['headline']), copy: String(args['copy']) }]
      ctx.scratch.set(key, next)
      return {
        text: `Saved variant ${next.length} for ${item.title}. It is on this machine only. ` +
          'Call submit_for_review when one of them is ready for the room to see.',
        data: { variants: next.length },
        summary: `drafted variant ${next.length} of ${item.title}`,
      }
    },
  },
  {
    name: 'revise',
    description:
      'Rewrite your most recent draft for a post. Like drafting, this stays on this machine.',
    tier: 'work',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        headline: { type: 'string' },
        copy: { type: 'string' },
      },
      required: ['itemId', 'headline', 'copy'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No post called ${String(args['itemId'])}.` }
      const key = `draft:${item.id}`
      const prior = (ctx.scratch.get(key) as { headline: string; copy: string }[] | undefined) ?? []
      if (!prior.length) return { text: 'Nothing drafted for that post yet. Call draft_post first.' }
      prior[prior.length - 1] = { headline: String(args['headline']), copy: String(args['copy']) }
      ctx.scratch.set(key, prior)
      return { text: `Revised your draft for ${item.title}.`, summary: `revised ${item.title}` }
    },
  },
  {
    name: 'submit_for_review',
    description:
      'Put your current draft on the board for the room to see. This is the point where your ' +
      'words become visible to everyone, so only submit the one you mean.',
    tier: 'share',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' } },
      required: ['itemId'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No post called ${String(args['itemId'])}.` }
      const drafts = (ctx.scratch.get(`draft:${item.id}`) as { headline: string; copy: string }[] | undefined) ?? []
      const latest = drafts[drafts.length - 1]
      if (!latest) return { text: 'Nothing drafted for that post yet. Call draft_post first.' }
      ctx.put({
        ...item,
        state: 'review',
        owner: ctx.me.id,
        body: { ...body(item), headline: latest.headline, submitted: latest.copy },
      })
      return {
        text: `Submitted "${latest.headline}" for ${item.title}. It is on the board now, waiting for the manager.`,
        summary: `submitted "${latest.headline}" for ${item.title} after ${drafts.length} variants`,
      }
    },
  },
  {
    name: 'publish',
    description: 'Publish a post that has been submitted for review, so it goes live on its channel.',
    tier: 'commit',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' } },
      required: ['itemId'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No post called ${String(args['itemId'])}.` }
      if (!ctx.approved) {
        return {
          text: `publish ${item.title} to ${body(item).channel}`,
          summary: `publish "${body(item).headline || item.title}" to ${body(item).channel}`,
        }
      }
      ctx.put({ ...item, state: 'done' })
      return {
        text: `${item.title} is live on ${body(item).channel}.`,
        summary: `published "${body(item).headline || item.title}" to ${body(item).channel}`,
      }
    },
  },
]

export const campaign: RoomDefinition = {
  id: 'campaign',
  title: 'Q3 Launch campaign',
  premise: 'A marketing team writing the posts for a product launch.',
  stewardRole: 'marketing manager',
  memberRole: 'marketer',
  memberTools,
  stewardTools: [],
  signals: [
    {
      id: 'churn',
      label: 'Stuck in drafting',
      detect: (_events, room) => {
        const drafts = callCount(room, 'draft_post') + callCount(room, 'revise')
        const sent = callCount(room, 'submit_for_review')
        return drafts >= 5 && sent === 0
          ? `${drafts} drafts written and nothing submitted yet. Someone may be stuck on the brief.`
          : null
      },
    },
    {
      id: 'waiting',
      label: 'Waiting on you',
      detect: (_events, room) =>
        room.approvals.length
          ? `${room.approvals.length} action${room.approvals.length > 1 ? 's' : ''} waiting on your approval.`
          : null,
    },
  ],
  seed: (_people: Person[]): WorkItem[] => [
    {
      id: 'post_1', title: 'Launch announcement', state: 'open',
      body: { brief: 'Announce the Q3 launch, lead with the pricing change', channel: 'blog', headline: '', submitted: '' },
    },
    {
      id: 'post_2', title: 'Pricing explainer', state: 'open',
      body: { brief: 'Explain the new tiers without sounding defensive', channel: 'email', headline: '', submitted: '' },
    },
    {
      id: 'post_3', title: 'Customer story', state: 'open',
      body: { brief: 'One paragraph on how Harbour Foods uses it', channel: 'social', headline: '', submitted: '' },
    },
  ],
}
