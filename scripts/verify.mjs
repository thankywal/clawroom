/* Minimal CDP driver: open a URL headlessly, wait for a predicate, print a result. */
const [,, url, expr] = process.argv;
const base = 'http://127.0.0.1:' + (process.env.CDP_PORT || 9333);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() { return (await fetch(base + '/json')).json(); }

let t;
for (let i = 0; i < 40 && !t; i++) {
  try { t = (await targets()).find(x => x.type === 'page'); } catch {}
  if (!t) await sleep(250);
}
if (!t) { console.log('NO_TARGET'); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const waiting = new Map();
const send = (method, params={}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({id:i, method, params})); });
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
await new Promise(r => ws.onopen = r);

await send('Page.enable');
await send('Page.navigate', { url });
await sleep(1500);

for (let i = 0; i < 30; i++) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const v = r.result?.result?.value;
  if (v && !/^running/i.test(String(v)) && !String(v).startsWith('__PENDING')) { console.log(v); process.exit(0); }
  await sleep(500);
}
console.log('TIMED_OUT');
process.exit(2);
