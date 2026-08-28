/* Council WebMCP tool surface.
 *
 * Tools are grouped by zone. Private-zone tools touch localStorage and return
 * verdicts; public-zone tools write state every participant can see. The
 * grouping is not cosmetic — it is the whole privacy argument, so it is
 * visible in the code, in the tool descriptions, and in the UI.
 */

import { CATALOG, getOption, loadPrivate, savePrivate, checkFit,
         recordVerdict, analyse, PUBLIC } from './state.js';

/* Chrome ships this on document; some builds expose navigator. Resolve once. */
export const mc =
  (typeof document !== 'undefined' && document.modelContext) ||
  (typeof navigator !== 'undefined' && navigator.modelContext) ||
  null;

export const namespace = document.modelContext ? 'document' : (navigator.modelContext ? 'navigator' : null);

const text = t => ({ content:[{ type:'text', text:t }] });

export async function registerCouncilTools({ me, onActivity }) {
  if (!mc) return { ok:false, reason:'WebMCP unavailable' };
  const ac = new AbortController();
  const say = (tool, detail, zone) => onActivity?.({ actor:me.id, tool, detail, zone });

  const reg = def => mc.registerTool(def, { signal: ac.signal });

  /* ---------------- PRIVATE ZONE — never leaves this browser ---------------- */

  await reg({
    name: 'remember_my_constraints',
    description:
      'Store MY private constraints for this Council. Hard constraints are absolute ' +
      '(blockDate, maxTotal, excludeTag); soft ones are weighted preferences ' +
      '(prefer/avoid a tag, weight 0-1). Stored only in this browser and never shared ' +
      'with the Council or other participants. Do not repeat the values back publicly.',
    inputSchema: {
      type:'object',
      properties:{
        hard:{ type:'array', items:{ type:'object', properties:{
          id:{type:'string'}, type:{type:'string', enum:['blockDate','maxTotal','excludeTag']},
          value:{} }, required:['id','type','value'] } },
        soft:{ type:'array', items:{ type:'object', properties:{
          id:{type:'string'}, type:{type:'string', enum:['prefer','avoid']},
          value:{type:'string'}, weight:{type:'number', minimum:0, maximum:1} },
          required:['id','type','value','weight'] } }
      },
      required:['hard','soft']
    },
    annotations:{ readOnlyHint:false },
    execute: async ({hard=[], soft=[]}) => {
      const n = savePrivate(me.id, {hard, soft});
      say('remember_my_constraints', `${n.hard} hard · ${n.soft} soft`, 'private');
      return text(`Stored locally: ${n.hard} hard, ${n.soft} soft. Nothing was shared.`);
    }
  });

  await reg({
    name: 'get_my_constraints',
    description: 'Read back MY OWN private constraints from this browser. Never share these values in a public tool call.',
    inputSchema:{ type:'object', properties:{}, additionalProperties:false },
    annotations:{ readOnlyHint:true },
    execute: async () => {
      const c = loadPrivate(me.id);
      say('get_my_constraints', `${c.hard.length} hard · ${c.soft.length} soft`, 'private');
      return { ...text(JSON.stringify(c)), structuredContent:c };
    }
  });

  await reg({
    name: 'check_fit',
    description:
      'Test one option against MY private constraints. Runs entirely in this browser. ' +
      'Returns whether it is feasible, a 0-1 preference score, the IDs of any blocking ' +
      'constraints, and what would have to give for it to fit. It deliberately does NOT ' +
      'return the constraint values — use it to decide, then share only your verdict.',
    inputSchema:{ type:'object', properties:{ optionId:{type:'string'} }, required:['optionId'] },
    annotations:{ readOnlyHint:true },
    execute: async ({optionId}) => {
      const r = checkFit(me.id, optionId);
      say('check_fit', `${optionId} → ${r.feasible ? 'fits' : 'blocked'} (score ${r.score})`, 'private');
      return { ...text(JSON.stringify(r)), structuredContent:r };
    }
  });

  await reg({
    name: 'relax_constraint',
    description:
      'Loosen one of MY hard constraints after my human has approved a concession. ' +
      'Ask before calling this — it changes what I am willing to accept.',
    inputSchema:{ type:'object', properties:{ constraintId:{type:'string'} }, required:['constraintId'] },
    annotations:{ readOnlyHint:false },
    execute: async ({constraintId}) => {
      const c = loadPrivate(me.id);
      const before = c.hard.length;
      c.hard = c.hard.filter(h => h.id !== constraintId);
      savePrivate(me.id, c);
      say('relax_constraint', constraintId, 'private');
      return text(before === c.hard.length ? `No constraint ${constraintId}.` : `Relaxed ${constraintId}.`);
    }
  });

  /* ---------------- PUBLIC ZONE — every participant sees this ---------------- */

  await reg({
    name: 'list_options',
    description: 'List every option on the table in this Council, with dates, price and tags.',
    inputSchema:{ type:'object', properties:{
      maxPrice:{type:'number'}, startsOnOrAfter:{type:'string'} }, additionalProperties:false },
    annotations:{ readOnlyHint:true },
    execute: async ({maxPrice, startsOnOrAfter}={}) => {
      let rows = CATALOG;
      if (maxPrice) rows = rows.filter(o => o.price <= maxPrice);
      if (startsOnOrAfter) rows = rows.filter(o => o.start >= startsOnOrAfter);
      say('list_options', `${rows.length} option(s)`, 'public');
      return { ...text(JSON.stringify(rows)), structuredContent:{ options:rows } };
    }
  });

  await reg({
    name: 'propose',
    description: 'Publicly accept an option on my behalf. Every participant sees this.',
    inputSchema:{ type:'object', properties:{
      optionId:{type:'string'}, note:{type:'string', description:'Optional public note'} },
      required:['optionId'] },
    annotations:{ readOnlyHint:false },
    execute: async ({optionId, note=''}) => {
      if (!getOption(optionId)) return text(`No option ${optionId}.`);
      recordVerdict(me.id, optionId, 'propose', note);
      say('propose', optionId, 'public');
      return text(`Proposed ${optionId}.`);
    }
  });

  await reg({
    name: 'reject',
    description:
      'Publicly reject an option on my behalf, with a short public reason. ' +
      'Keep the reason vague enough to protect my private context — say what does ' +
      'not work, never why it does not work.',
    inputSchema:{ type:'object', properties:{
      optionId:{type:'string'},
      publicReason:{type:'string', description:'Short, non-revealing, e.g. "those dates do not work for me"'} },
      required:['optionId','publicReason'] },
    annotations:{ readOnlyHint:false },
    execute: async ({optionId, publicReason}) => {
      if (!getOption(optionId)) return text(`No option ${optionId}.`);
      recordVerdict(me.id, optionId, 'reject', publicReason);
      say('reject', `${optionId} — "${publicReason}"`, 'public');
      return text(`Rejected ${optionId}.`);
    }
  });

  await reg({
    name: 'get_council_state',
    description:
      'Read the shared Council: who has accepted or rejected what, whether consensus ' +
      'has been reached, and which options are one concession away from agreement.',
    inputSchema:{ type:'object', properties:{}, additionalProperties:false },
    annotations:{ readOnlyHint:true },
    execute: async () => {
      const a = analyse();
      const summary = {
        participants: PUBLIC.participants.map(p => ({id:p.id, name:p.name})),
        consensus: a.consensus ? a.consensus.option.id : null,
        oneConcessionAway: a.nearest.map(r => ({
          optionId: r.option.id, price: r.option.price, blockedBy: r.rejected
        })),
        verdicts: PUBLIC.verdicts
      };
      say('get_council_state', a.consensus ? 'consensus reached' : `${a.nearest.length} near-miss`, 'public');
      return { ...text(JSON.stringify(summary)), structuredContent:summary };
    }
  });

  return { ok:true, abort:() => ac.abort(), namespace };
}
