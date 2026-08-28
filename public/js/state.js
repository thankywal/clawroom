/* Council state — catalog, private zone, public zone.
 *
 * The only rule that matters in this file: values written into PRIVATE never
 * appear in anything the PUBLIC zone can serialise. `checkFit` reads private
 * constraints and returns a verdict; it never returns the constraint values.
 */

/* ---------- seeded catalog (the page owns it — no external search) ---------- */

export const CATALOG = [
  { id:'opt_01', label:'Shinjuku · budget',   start:'2026-09-10', end:'2026-09-13', price:640, tags:['hostel','earlyDeparture','direct'] },
  { id:'opt_02', label:'Ueno · budget',       start:'2026-09-10', end:'2026-09-14', price:710, tags:['hostel','midDeparture','layover'] },
  { id:'opt_03', label:'Asakusa · standard',  start:'2026-09-11', end:'2026-09-14', price:780, tags:['hotel','earlyDeparture','direct'] },
  { id:'opt_04', label:'Shibuya · standard',  start:'2026-09-12', end:'2026-09-15', price:890, tags:['hotel','midDeparture','direct'] },
  { id:'opt_05', label:'Ginza · comfort',     start:'2026-09-12', end:'2026-09-16', price:1180,tags:['hotel','midDeparture','direct'] },
  { id:'opt_06', label:'Nakano · budget',     start:'2026-09-13', end:'2026-09-16', price:660, tags:['hostel','midDeparture','layover'] },
  { id:'opt_07', label:'Yanaka · ryokan',     start:'2026-09-13', end:'2026-09-16', price:840, tags:['ryokan','midDeparture','direct'] },
  { id:'opt_08', label:'Kanda · standard',    start:'2026-09-14', end:'2026-09-17', price:760, tags:['hotel','midDeparture','direct'] },
];

export const getOption = id => CATALOG.find(o => o.id === id) || null;

const datesIn = o => {
  const out = [], d = new Date(o.start), end = new Date(o.end);
  while (d <= end) { out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
  return out;
};

/* ---------- PRIVATE ZONE — localStorage, never synced ---------- */

const pkey = pid => `council:private:${pid}`;

export function loadPrivate(pid) {
  try { return JSON.parse(localStorage.getItem(pkey(pid))) || { hard:[], soft:[] }; }
  catch { return { hard:[], soft:[] }; }
}

export function savePrivate(pid, c) {
  localStorage.setItem(pkey(pid), JSON.stringify(c));
  return { hard: c.hard.length, soft: c.soft.length };
}

/* The hinge. Runs in the participant's browser, over data that never syncs.
 * Returns a verdict, a score, and blocker IDs — never the constraint values. */
export function checkFit(pid, optionId) {
  const opt = getOption(optionId);
  if (!opt) return { error:'unknown option' };
  const { hard, soft } = loadPrivate(pid);
  const days = datesIn(opt);

  const blockers = [], concessions = [];
  for (const c of hard) {
    let violated = false, wouldFitIf = null;
    if (c.type === 'blockDate' && days.includes(c.value)) {
      violated = true; wouldFitIf = { allowDate: c.value };
    } else if (c.type === 'maxTotal' && opt.price > c.value) {
      violated = true; wouldFitIf = { raiseBudgetTo: opt.price };
    } else if (c.type === 'excludeTag' && opt.tags.includes(c.value)) {
      violated = true; wouldFitIf = { allowTag: c.value };
    }
    if (violated) { blockers.push(c.id); concessions.push({ constraintId:c.id, wouldFitIf }); }
  }

  let num = 0, den = 0;
  for (const s of soft) {
    den += s.weight;
    const has = opt.tags.includes(s.value);
    if ((s.type === 'prefer' && has) || (s.type === 'avoid' && !has)) num += s.weight;
  }
  const score = den ? +(num/den).toFixed(2) : 1;

  return { optionId, feasible: blockers.length === 0, score, blockers, concessions };
}

/* ---------- PUBLIC ZONE — shared with every participant ---------- */

export const PUBLIC = {
  participants: [],                 // { id, name, colour }
  verdicts: {},                     // participantId -> optionId -> { type, publicReason }
  concessionRequests: [],           // { id, participantId, optionId, ask }
};

export function addParticipant(p) {
  if (!PUBLIC.participants.some(x => x.id === p.id)) PUBLIC.participants.push(p);
  PUBLIC.verdicts[p.id] ||= {};
}

export function recordVerdict(pid, optionId, type, publicReason='') {
  PUBLIC.verdicts[pid] ||= {};
  PUBLIC.verdicts[pid][optionId] = { type, publicReason };
}

/* Deadlock analysis uses ONLY public verdicts. It can see who rejected what.
 * It cannot see why, and does not need to. */
export function analyse() {
  const ids = PUBLIC.participants.map(p => p.id);
  const rows = CATALOG.map(o => {
    const accepted = ids.filter(i => PUBLIC.verdicts[i]?.[o.id]?.type === 'propose');
    const rejected = ids.filter(i => PUBLIC.verdicts[i]?.[o.id]?.type === 'reject');
    return { option:o, accepted, rejected, undecided: ids.length - accepted.length - rejected.length };
  });
  const consensus = rows.find(r => r.accepted.length === ids.length && ids.length > 1) || null;
  const nearest  = rows.filter(r => r.rejected.length === 1 && r.undecided === 0)
                       .sort((a,b) => a.option.price - b.option.price);
  return { rows, consensus, nearest, participantCount: ids.length };
}
