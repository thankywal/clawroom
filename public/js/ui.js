/* Council UI — renders the two zones, the shared table, and the activity feed.
 *
 * Demo participants run in this same browser, each with their own isolated
 * private store, so one person can convene a full Council. Same architecture,
 * simulated: their constraints are never readable from the public zone either.
 */

import { CATALOG, savePrivate, loadPrivate, checkFit, addParticipant,
         recordVerdict, analyse, PUBLIC } from './state.js';
import { registerCouncilTools, mc, namespace } from './tools.js';

/* ---------- identity ---------- */
const ME = { id:'you', name:'You', colour:'var(--p1)' };
const DEMO = [
  { id:'mya', name:'Mya', colour:'var(--p2)' },
  { id:'su',  name:'Su',  colour:'var(--p3)' },
];
const who = id => [ME,...DEMO].find(p => p.id === id) || {name:id, colour:'var(--dim)'};

/* Seeded so a deadlock is guaranteed and lands on the visitor.
 * opt_08 ends up one concession away, blocked only by You, by $10. */
const SEED = {
  you: { hard:[{id:'c_budget', type:'maxTotal', value:750}],
         soft:[{id:'s_direct', type:'prefer', value:'direct', weight:.7}] },
  mya: { hard:[{id:'c_sep13', type:'blockDate', value:'2026-09-13'}],
         soft:[{id:'s_hotel', type:'prefer', value:'hotel', weight:.5}] },
  su:  { hard:[{id:'c_nohostel', type:'excludeTag', value:'hostel'}],
         soft:[{id:'s_ryokan', type:'prefer', value:'ryokan', weight:.6}] },
};

/* ---------- activity feed ---------- */
const ZI = { private:'🔒', public:'🌐', human:'✋' };
function activity({actor, tool, detail, zone}) {
  const p = who(actor);
  document.getElementById('feed').insertAdjacentHTML('beforeend',
    `<div class="ev ${zone==='human'?'human':''}">
       <span class="who" style="color:${p.colour}">${p.name}</span>
       <span class="zn">${ZI[zone]||''}</span>
       <span class="what">${tool}</span>
       <span class="det">${detail||''}</span>
     </div>`);
  const f = document.getElementById('feed'); f.scrollTop = 1e9;
}

/* ---------- render ---------- */
function renderBar() {
  const live = !!mc;
  document.getElementById('bar').innerHTML =
    [ME,...DEMO].map(p => `<span class="pill"><i style="background:${p.colour}"></i>${p.name}</span>`).join('') +
    `<span class="status ${live?'live':''}">${live
      ? `WebMCP live · ${namespace}.modelContext`
      : 'WebMCP unavailable — enable chrome://flags/#enable-webmcp-testing'}</span>`;
}

function renderPrivate() {
  const c = loadPrivate(ME.id);
  const chips = [
    ...c.hard.map(h => `<span class="chip hard">hard · ${h.type} ${h.value}</span>`),
    ...c.soft.map(s => `<span class="chip soft">soft · ${s.type} ${s.value} ×${s.weight}</span>`)
  ];
  document.getElementById('privBody').innerHTML =
    (chips.length
      ? `<div class="chips">${chips.join('')}</div>`
      : `<p class="empty">Nothing stored yet. Tell your agent what matters to you.</p>`) +
    `<p class="empty" style="margin-top:10px">Your agent reads these to decide.
      The Council never sees them.</p>` + publicFootprint();
}

/* Everything the Council actually learned about you. The contrast with the
 * panel above it is the entire argument, so it is shown side by side. */
function publicFootprint() {
  const mine = PUBLIC.verdicts[ME.id] || {};
  const rows = Object.entries(mine);
  if (!rows.length) return '';
  return `<div style="margin-top:16px;padding-top:13px;border-top:1px solid var(--line)">
    <div style="font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;
                color:var(--dimmer);font-weight:600;margin-bottom:7px">
      🌐 What the Council learned about you</div>
    <div class="chips">${rows.map(([id,v]) =>
      `<span class="chip">${id.replace('opt_','#')} ${v.type==='propose'?'✓':'✗'}${
        v.publicReason ? ' “'+v.publicReason+'”' : ''}</span>`).join('')}</div>
    <p class="empty" style="margin-top:9px">Verdicts, never reasons.</p>
  </div>`;
}

function renderCouncil() {
  const a = analyse();
  document.getElementById('optRows').innerHTML = a.rows.map(r => {
    const dots = [ME,...DEMO].map(p => {
      const v = PUBLIC.verdicts[p.id]?.[r.option.id];
      const cls = v ? (v.type==='propose'?'y':'n') : '';
      const title = v ? (v.type==='propose' ? 'accepted' : `rejected — "${v.publicReason}"`) : 'undecided';
      return `<span class="dot ${cls}" title="${p.name}: ${title}">${p.name[0]}</span>`;
    }).join('');
    const hit = a.consensus?.option.id === r.option.id;
    return `<tr class="${hit?'consensus':''}">
      <td class="opt">${r.option.label}<br><span class="meta">${r.option.tags.join(' · ')}</span></td>
      <td class="meta">${r.option.start.slice(5)} → ${r.option.end.slice(5)}</td>
      <td class="meta">$${r.option.price}</td>
      <td><div class="verd">${dots}</div></td>
    </tr>`;
  }).join('');
  renderOutcome(a);
}

function renderOutcome(a) {
  const el = document.getElementById('outcome');
  const has = id => Object.keys(PUBLIC.verdicts[id] || {}).length > 0;
  const othersIn = DEMO.some(d => has(d.id));
  const iAmIn = has(ME.id);

  /* Stage 1 — nobody has spoken. This is how group decisions work today. */
  if (!othersIn && !iAmIn) {
    el.innerHTML = `<div class="banner">Right now this is a spreadsheet. To find an
      overlap everyone has to publish what they can and cannot do — budgets, dates,
      reasons. That is the cost of deciding together today.
      <div class="btns" style="margin-top:10px">
        <button class="primary" id="convene">Convene the Council</button>
      </div></div>`;
    document.getElementById('convene').onclick = () => DEMO.forEach(runRound);
    return;
  }

  /* Stage 2 — the others have spoken, you have not. Your agent's turn. */
  if (!iAmIn) {
    el.innerHTML = `<div class="banner">Mya and Su have sent their agents. Their verdicts
      are public; their reasons are not. <b>Your turn.</b>
      <div style="margin-top:8px;font-size:12.5px;color:var(--dim)">Tell your agent:
      <i>“I'm in this Council. Store my constraints, then check every option and
      propose or reject for me.”</i></div>
      <div class="btns" style="margin-top:10px">
        <button class="ghost" id="myround">Run my round without an agent</button>
      </div></div>`;
    document.getElementById('myround').onclick = () => runRound(ME);
    return;
  }

  if (a.consensus) {
    el.innerHTML = `<div class="banner ok">✓ <b>Consensus — ${a.consensus.option.label}</b>,
      ${a.consensus.option.start.slice(5)} → ${a.consensus.option.end.slice(5)},
      $${a.consensus.option.price}. Every participant accepted, and nobody learned why
      anyone else had said no.</div>`;
    return;
  }

  const near = a.nearest.find(n => n.rejected.includes(ME.id));
  if (near) {
    const opt = near.option, fit = checkFit(ME.id, opt.id), c = fit.concessions[0];
    const ask = c?.wouldFitIf.raiseBudgetTo ? `raise your ceiling to $${c.wouldFitIf.raiseBudgetTo}`
              : c?.wouldFitIf.allowDate     ? `allow ${c.wouldFitIf.allowDate}`
              : c?.wouldFitIf.allowTag      ? `accept ${c.wouldFitIf.allowTag}`
              : 'relax one constraint';
    el.innerHTML =
      `<div class="banner warn">No option works for everyone. <b>${opt.label}</b> is one
        concession away — and you are the only participant blocking it.</div>
       <div class="ask">
         <h3>🔒 Your agent is asking you</h3>
         <p>“If you ${ask}, the whole Council agrees on ${opt.label}.
            You told me privately that you could not. May I?”</p>
         <div class="btns">
           <button class="primary" id="allow">Allow it</button>
           <button class="ghost" id="deny">No — hold my line</button>
         </div>
       </div>`;
    document.getElementById('allow').onclick = () => {
      activity({actor:ME.id, tool:'approved concession', detail:ask, zone:'human'});
      const p = loadPrivate(ME.id);
      p.hard = p.hard.filter(h => h.id !== c.constraintId);
      savePrivate(ME.id, p);
      renderPrivate(); runRound(ME);
    };
    document.getElementById('deny').onclick = () =>
      activity({actor:ME.id, tool:'declined concession', detail:'private line held', zone:'human'});
    return;
  }

  const other = a.nearest[0];
  el.innerHTML = other
    ? `<div class="banner warn"><b>${other.option.label}</b> is one concession away, and the
        only blocker is ${other.rejected.map(i=>who(i).name).join(', ')}. Their agent is
        asking them now. You will see the answer, not the reason.</div>`
    : `<div class="banner warn">No option satisfies everyone, and none is a single
        concession away. Someone has to move — nobody has to say why.</div>`;
}

/* ---------- a round: what one participant does when its human says go ---------- */
function runRound(p) {
  for (const o of CATALOG) {
    const fit = checkFit(p.id, o.id);
    activity({actor:p.id, tool:'check_fit', detail:`${o.id} → ${fit.feasible?'fits':'blocked'} (${fit.score})`, zone:'private'});
    if (fit.feasible) { recordVerdict(p.id, o.id, 'propose'); activity({actor:p.id, tool:'propose', detail:o.id, zone:'public'}); }
    else {
      const c = fit.concessions[0]?.wouldFitIf || {};
      const reason = c.allowDate ? 'those dates do not work for me'
                   : c.raiseBudgetTo ? 'above what I can do'
                   : 'not something I can stay in';
      recordVerdict(p.id, o.id, 'reject', reason);
      activity({actor:p.id, tool:'reject', detail:`${o.id} — “${reason}”`, zone:'public'});
    }
  }
  renderCouncil();
}

/* ---------- boot ---------- */
[ME,...DEMO].forEach(p => {
  addParticipant(p);
  if (!localStorage.getItem(`council:private:${p.id}`)) savePrivate(p.id, SEED[p.id]);
});

renderBar(); renderPrivate(); renderCouncil();

registerCouncilTools({ me:ME, onActivity:(e)=>{ activity(e); renderPrivate(); renderCouncil(); } })
  .then(r => activity({actor:ME.id, tool: r.ok ? 'tools registered' : 'tools unavailable',
                       detail: r.ok ? `8 tools on ${r.namespace}.modelContext` : r.reason, zone:'human'}));
