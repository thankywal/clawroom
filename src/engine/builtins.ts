// Tools every room gets for free.
//
// Note what is absent. There is no approve tool. The steward's agent can read
// the queue and recommend, but only a person can click, because an agent that
// could approve its own room's commits would make the whole tier theatre.
//
// There is also no tool anywhere in this engine that returns a conversation or
// another member's scratch. read_work_log returns summary lines and nothing
// else. That absence is the product.

import type { RoomTool } from '../types.js'
import type { RoomStore } from './store.js'
import { evaluateSignals, computerUsage } from './signals.js'
import { computerTools } from './computer.js'
import { sourceAdminTools, sourceTools } from './sources.js'

const noArgs = { type: 'object', properties: {}, additionalProperties: false }

export function builtinMemberTools(store: RoomStore): RoomTool[] {
  return [
    {
      name: 'check_approval',
      title: 'Has it been approved yet',
      description:
        'Check whether a commit-tier action you asked for has been approved yet. ' +
        'Pass the handle you were given when it was parked.',
      tier: 'work',
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: { handle: { type: 'string', description: 'The apv_ handle you were given' } },
        required: ['handle'],
      },
      run: (_ctx, args) => {
        const handle = String(args['handle'] ?? '')
        const status = store.approvalStatus(handle)
        const text =
          status === 'pending'  ? `${handle} is still waiting on a human. Nothing has shipped.`
          : status === 'approved' ? `${handle} was approved and has taken effect.`
          : status === 'denied'   ? `${handle} was declined. Do not retry it; ask your human what to do instead.`
          : `No approval with handle ${handle} in this room.`
        return { text, data: { handle, status }, summary: `checked ${handle}` }
      },
    },
    {
      name: 'my_pending_approvals',
      title: 'What of mine is waiting',
      description: 'List the commit-tier actions you have asked for that are still waiting on a human.',
      tier: 'work',
      readOnly: true,
      inputSchema: noArgs,
      run: (ctx) => {
        const mine = ctx.room.approvals.filter(a => a.requestedBy === ctx.me.id)
        return {
          text: mine.length
            ? mine.map(a => `${a.id}: ${a.describe}`).join('\n')
            : 'Nothing of yours is waiting on approval.',
          data: { approvals: mine.map(a => ({ id: a.id, describe: a.describe })) },
          summary: `checked ${mine.length} pending`,
        }
      },
    },
    ...computerTools(store),
    ...sourceAdminTools(store),
    ...sourceTools(store),
  ]
}

export function builtinStewardTools(store: RoomStore): RoomTool[] {
  return [
    // The steward reads the sources; adding one is a button, not a tool. An
    // agent that could file the approval its own human is about to click is
    // a strange thing to hand the person doing the approving.
    ...sourceAdminTools(store).filter(t => t.name !== 'add_tool_source'),
    ...sourceTools(store),
    {
      name: 'computer_usage',
      title: "How the room's computers are being used",
      description:
        "How each member's computer has been used, as counts: commands run, how many failed, files " +
        'written, files shared to the board. Never the commands, the output or the files.',
      tier: 'work',
      readOnly: true,
      inputSchema: noArgs,
      run: (ctx) => {
        const rows = computerUsage(ctx.room)
        return {
          text: rows.length
            ? rows.map(r => `${r.name}: ${r.runs} commands (${r.failed} failed), ${r.writes} files written, ${r.shares} shared`).join('\n')
            : 'No computer has been used in this room yet.',
          data: { usage: rows },
          summary: `read computer usage for ${rows.length} member${rows.length === 1 ? '' : 's'}`,
        }
      },
    },
    {
      name: 'read_work_log',
      title: 'Read the work log',
      description:
        'Read what has happened in this room: who did what, through which tool, and when. ' +
        'This returns one summary line per action. It does not and cannot return anyone\'s ' +
        'conversation with their agent, or the drafts they kept private.',
      tier: 'work',
      readOnly: true,
      untrusted: true,
      inputSchema: {
        type: 'object',
        properties: {
          sinceMinutes: { type: 'number', description: 'Only actions from the last N minutes' },
          limit: { type: 'number', description: 'How many lines at most, default 40' },
        },
      },
      run: (ctx, args) => {
        const since = typeof args['sinceMinutes'] === 'number'
          ? Date.now() - args['sinceMinutes'] * 60_000
          : 0
        const limit = typeof args['limit'] === 'number' ? args['limit'] : 40
        const name = (id: string) =>
          ctx.room.members.find(p => p.id === id)?.name ?? (id === ctx.room.steward.id ? ctx.room.steward.name : id)
        const rows = ctx.room.events
          .filter(e => e.at >= since)
          .slice(-limit)
          .map(e => `${name(e.actor)} ${e.kind === 'human' ? '(in person)' : ''} ${e.tool}: ${e.summary}`)
        return {
          text: rows.length ? rows.join('\n') : 'Nothing has happened in this room yet.',
          data: { lines: rows },
          summary: `read ${rows.length} log lines`,
        }
      },
    },
    {
      name: 'list_pending_approvals',
      title: 'What is waiting on a person',
      description:
        'List every commit-tier action waiting on a human in this room. You cannot approve ' +
        'them yourself. Report them to your human and say which you would approve and why.',
      tier: 'work',
      readOnly: true,
      inputSchema: noArgs,
      run: (ctx) => {
        // Including what each one would actually do. A queue that lists titles
        // teaches the steward's agent to recommend things it has not read.
        const lines = ctx.room.approvals.map(a => {
          const item = a.item ? ctx.room.items.find(i => i.id === a.item) : undefined
          const body = (item?.body ?? {}) as Record<string, unknown>
          const words = ['submitted', 'headline', 'reply', 'answer', 'brief']
            .map(k => body[k])
            .find(v => typeof v === 'string' && v) as string | undefined
          const args = Object.entries(a.args ?? {})
            .filter(([k]) => k !== 'itemId' && k !== 'which')
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join(' ')
          return `${a.id}: ${a.describe}` +
            (words ? `\n    the words: ${words.slice(0, 400)}` : '') +
            (args ? `\n    arguments: ${args.slice(0, 300)}` : '')
        })
        return {
          text: lines.length ? lines.join('\n') : 'Nothing is waiting on approval.',
          data: { approvals: ctx.room.approvals },
          summary: `read ${ctx.room.approvals.length} pending`,
        }
      },
    },
    {
      name: 'read_signals',
      title: 'What this room has noticed',
      description:
        'Read the patterns this room has noticed across everyone\'s work, for example several ' +
        'agents getting stuck in the same place. Use this to tell your human what needs them.',
      tier: 'work',
      readOnly: true,
      inputSchema: noArgs,
      run: (ctx) => {
        const fired = evaluateSignals(ctx.room)
        return {
          text: fired.length ? fired.map(f => f.text).join('\n') : 'Nothing worth flagging right now.',
          data: { signals: fired },
          summary: `read ${fired.length} signals`,
        }
      },
    },
  ]
}
