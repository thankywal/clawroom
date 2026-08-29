// A classroom where students bring their own agent.
//
// The current answer to students using AI is to ban it, which does not work,
// and then to buy an AI the school controls, which is a different product. The
// third option is the one nobody offers: let students bring whatever they
// already use, and give the teacher the shape of the help rather than the
// content of it.
//
// A hint is work tier, so the hint text stays on the student's machine. What
// reaches the teacher is that fourteen agents wanted help on question three,
// which is the only part a teacher can actually act on.

import type { Person, RoomDefinition, RoomTool, WorkItem } from '../types.js'
import { findItem } from '../engine/find.js'
import { distinctCallers } from '../engine/signals.js'

interface ProblemBody { question: string; answer: string; submitted: string }
const body = (i: WorkItem) => i.body as unknown as ProblemBody

const memberTools: RoomTool[] = [
  {
    name: 'get_problem',
    description: 'Read one problem from the worksheet, or all of them if you give no id.',
    tier: 'work',
    readOnly: true,
    inputSchema: { type: 'object', properties: { itemId: { type: 'string' } } },
    run: (ctx, args) => {
      const one = args['itemId'] ? findItem(ctx.room.items, args['itemId']) : null
      const rows = (one ? [one] : ctx.room.items).map(i => `${i.id} [${i.state}] ${body(i).question}`)
      return { text: rows.join('\n') || 'No problems set.', summary: `read ${rows.length} problem(s)` }
    },
  },
  {
    name: 'request_hint',
    description:
      'Ask for a hint on a problem. Level 1 is a nudge, level 2 is a worked step. The hint ' +
      'text stays on this machine. Your teacher learns that you asked, not what you were told.',
    tier: 'work',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        level: { type: 'number', description: '1 for a nudge, 2 for a worked step' },
      },
      required: ['itemId'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No problem called ${String(args['itemId'])}.` }
      const level = args['level'] === 2 ? 2 : 1
      const hint = level === 1
        ? `Look at what stays the same on both sides of ${body(item).question}.`
        : `Isolate the unknown first, then substitute back into ${body(item).question}.`
      ctx.scratch.set(`hint:${item.id}`, hint)
      return {
        text: hint,
        summary: `asked for a level ${level} hint on ${item.id}`,
      }
    },
  },
  {
    name: 'check_answer',
    description:
      'Check an answer privately before committing to it. Nobody sees what you tried, only ' +
      'that you checked.',
    tier: 'work',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' }, answer: { type: 'string' } },
      required: ['itemId', 'answer'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No problem called ${String(args['itemId'])}.` }
      const ok = String(args['answer']).trim() === body(item).answer
      const tries = Number(ctx.scratch.get(`tries:${item.id}`) ?? 0) + 1
      ctx.scratch.set(`tries:${item.id}`, tries)
      return {
        text: ok ? 'That is right. You can submit it.' : 'Not yet. Try again or ask for a hint.',
        data: { correct: ok, tries },
        summary: `checked an answer for ${item.id}, attempt ${tries}`,
      }
    },
  },
  {
    name: 'submit',
    description: 'Submit your answer to a problem so the class board shows it as done.',
    tier: 'share',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' }, answer: { type: 'string' } },
      required: ['itemId', 'answer'],
    },
    run: (ctx, args) => {
      const item = findItem(ctx.room.items, args['itemId'])
      if (!item) return { text: `No problem called ${String(args['itemId'])}.` }
      ctx.put({ ...item, state: 'done', owner: ctx.me.id, body: { ...body(item), submitted: String(args['answer']) } })
      return { text: `Submitted ${item.id}.`, summary: `submitted ${item.id}` }
    },
  },
  {
    name: 'request_extension',
    description: 'Ask the teacher for more time on the worksheet.',
    tier: 'commit',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'What you want the teacher to know' } },
      required: ['reason'],
    },
    run: (ctx) => {
      if (!ctx.approved) return { text: 'ask for an extension', summary: `give ${ctx.me.name} an extension` }
      return { text: 'The teacher granted the extension.', summary: `granted ${ctx.me.name} an extension` }
    },
  },
]

export const classroom: RoomDefinition = {
  id: 'classroom',
  title: 'Tuesday worksheet',
  premise: 'A class working through a set of problems, each student with their own agent.',
  stewardRole: 'teacher',
  memberRole: 'student',
  memberTools,
  stewardTools: [],
  signals: [
    {
      id: 'stuck',
      label: 'The class is stuck',
      detect: (_e, room) => {
        for (const item of room.items) {
          const asked = room.events.filter(e => e.tool === 'request_hint' && e.item === item.id).length
          if (asked >= 3) return `${asked} hint requests on ${item.id}. That question is not landing.`
        }
        const total = distinctCallers(room, 'request_hint')
        return total >= 3 ? `${total} students have asked for hints. Worth a pause.` : null
      },
    },
  ],
  seed: (_people: Person[]): WorkItem[] => [
    { id: 'q1', title: 'Question 1', state: 'open', body: { question: '2x + 6 = 14', answer: '4', submitted: '' } },
    { id: 'q2', title: 'Question 2', state: 'open', body: { question: '3(x - 2) = 9', answer: '5', submitted: '' } },
    { id: 'q3', title: 'Question 3', state: 'open', body: { question: 'x/4 + 7 = 10', answer: '12', submitted: '' } },
  ],
}
