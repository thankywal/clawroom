/* Drive the tier ablation headlessly and print the counts.
 *
 * The page is the artefact and this only presses the button, so a judge who
 * opens /ablate.html sees exactly what this prints. Polls for a long time
 * because each trial is a real multi turn agent run against a real model.
 *
 *   node scripts/ablate.mjs https://clawroom.thankywal-bkk.workers.dev/ablate.html?auto=1&n=5
 */
const [,, url] = process.argv;
const base = 'http://127.0.0.1:' + (process.env.CDP_PORT || 9333);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let t;
for (let i = 0; i < 40 && !t; i++) {
  try { t = (await (await fetch(base + '/json')).json()).find(x => x.type === 'page'); } catch {}
  if (!t) await sleep(250);
}
if (!t) { console.log('NO_TARGET'); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const waiting = new Map();
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
await new Promise(r => ws.onopen = r);

await send('Page.enable');
await send('Page.navigate', { url });

const read = async expr => (await send('Runtime.evaluate',
  { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

const want = Number(new URL(url).searchParams.get('n') || 5) * 2;

// 25 minutes. Ten multi turn agent runs against a small model is not quick.
for (let i = 0; i < 1500; i++) {
  await sleep(1000);
  const note = await read("document.getElementById('tally')?.textContent?.trim() ?? ''");
  if (i % 15 === 0) process.stderr.write(`  ${note.slice(0, 90)}\n`);
  const total = await read('document.querySelectorAll("#cases .case").length');
  if (total < want) continue;

  const tally = JSON.parse(await read('JSON.stringify(window.__ablate ?? null)'));
  const trials = JSON.parse(await read(`JSON.stringify([...document.querySelectorAll('#cases .case')].map(c => ({
    trial: c.querySelector('.nm').textContent,
    calls: c.querySelector('.zn').textContent,
    verdict: c.querySelector('.verdict').textContent,
    said: c.querySelector('.cb').textContent.trim(),
  })))`));

  const out = { ran: new Date().toISOString(), url, model: 'workers ai, see worker/llm.ts', tally, trials };
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('docs/evidence', { recursive: true });
  const file = `docs/evidence/ablation-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  process.stderr.write(`  wrote ${file}\n`);
  console.log(JSON.stringify(tally));
  process.exit(0);
}
console.log('TIMED_OUT');
process.exit(2);
