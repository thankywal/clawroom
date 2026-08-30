// Every ClawRoom tool, called the way an agent would call it, with no agent.
//
// This page is the proof that the engine works, and it is deliberately the
// first thing built rather than the last. Two of the cases are not really
// tests of a function, they are tests of the product's central claim: that a
// work-tier payload never reaches shared state, and that a commit-tier call
// changes nothing until a person says so.

import type { RoomStore } from '../engine/store.js'
import { createStore } from '../engine/store.js'
import { createToolHost, namespaceName, resolveModelContext } from '../engine/webmcp.js'
import { settleApproval } from '../engine/tiers.js'
import { addSourceAsHuman, inspectSource, sourceToolName } from '../engine/sources.js'
import { campaign } from '../rooms/campaign.js'
import { clearPrivate } from '../engine/identity.js'
import { setComputerAccess } from '../engine/computer.js'

const $ = (id: string) => document.getElementById(id)

const ME = { id: 'selftest', name: 'Self test', colour: '#3fa9ac' }
const STEWARD = { id: 'selftest-steward', name: 'Manager', colour: '#a980e0' }
const SECRET = 'this exact sentence must never reach shared state'

interface Unwrapped { text: string; data: unknown }

/** executeTool hands back the envelope as a JSON string, so unwrapping is two
 *  parses deep: the envelope, then the tool's own payload inside content. */
export function unwrap(raw: unknown): Unwrapped {
  let env: any = raw
  if (typeof env === 'string') {
    try { env = JSON.parse(env) } catch { return { text: String(raw), data: null } }
  }
  const text: string = Array.isArray(env?.content)
    ? env.content.map((c: any) => c?.text ?? '').join('')
    : typeof raw === 'string' ? raw : JSON.stringify(raw)
  let data: unknown = env?.structuredContent ?? null
  if (data === null) { try { data = JSON.parse(text) } catch { /* text is prose */ } }
  return { text, data }
}

let passed = 0
let total = 0

function report(name: string, zone: string, ok: boolean, detail: string): void {
  total++
  if (ok) passed++
  $('cases')?.insertAdjacentHTML('beforeend', `
    <div class="case">
      <div class="ch">
        <span><span class="nm">${name}</span> <span class="zn">${zone}</span></span>
        <span class="verdict ${ok ? 'p' : 'f'}">${ok ? 'PASS' : 'FAIL'}</span>
      </div>
      <div class="cb">${detail.slice(0, 260).replace(/</g, '&lt;')}</div>
    </div>`)
}

async function main(): Promise<void> {
  const mc = resolveModelContext()
  if (!mc) {
    if ($('tally')) $('tally')!.innerHTML = '<span class="verdict f">WebMCP unavailable</span>'
    return
  }

  // A real room, because the computer tools need one to exist on the server.
  // Everything else in this test stays local to this page.
  const minted = await fetch('/api/rooms', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defId: 'campaign', title: 'Self test' }),
  }).then(r => r.json() as Promise<{ roomId: string; member: string }>)
  const roomKey = minted.roomId
  setComputerAccess({ key: minted.member })
  clearPrivate(roomKey, ME.id)

  const store: RoomStore = createStore({ def: campaign, roomKey, me: ME, role: 'member' })
  store.seedIfFirst(true)

  const host = createToolHost()
  await host.mount(campaign, { store, me: ME, isSteward: false })

  const call = async (name: string, args: Record<string, unknown>): Promise<Unwrapped> => {
    const handle = await host.handle(name)
    if (!handle) return { text: `ERROR tool ${name} is not registered`, data: null }
    return unwrap(await mc.executeTool(handle, JSON.stringify(args)))
  }

  // 1. reading the shared board
  const list = await call('list_posts', {})
  report('list_posts', 'work, read only', /post_1/.test(list.text) && /post_3/.test(list.text), list.text)

  // 2. a work-tier draft, and the claim that matters
  const d1 = await call('draft_post', { itemId: 'post_1', headline: 'Bigger, cheaper', copy: SECRET })
  report('draft_post', 'work, stays local', /variant 1/.test(d1.text), d1.text)

  const leaked = JSON.stringify({ items: store.state.items, events: store.state.events })
  report(
    'the draft never reaches shared state', 'the whole point',
    !leaked.includes(SECRET),
    leaked.includes(SECRET)
      ? 'FAILED: the draft copy was found in shared state'
      : 'shared state holds the summary line and no draft copy',
  )

  // 3. a second variant, then a revision
  await call('draft_post', { itemId: 'post_1', headline: 'Same, less money', copy: 'second variant' })
  const rev = await call('revise', { itemId: 'post_1', headline: 'Same, less money', copy: 'tightened' })
  report('revise', 'work, stays local', /Revised/.test(rev.text), rev.text)

  // 4. share tier puts one version on the board
  const sub = await call('submit_for_review', { itemId: 'post_1' })
  const item = store.state.items.find(i => i.id === 'post_1')
  report(
    'submit_for_review', 'share, now visible',
    item?.state === 'review' && (item.body as any).headline === 'Same, less money',
    `${sub.text} | board state: ${item?.state}`,
  )

  // 5. commit tier parks instead of acting
  const pub = await call('publish', { itemId: 'post_1' })
  const handle = (pub.data as any)?.approvalId as string | undefined
  const afterAsk = store.state.items.find(i => i.id === 'post_1')
  report(
    'publish parks instead of publishing', 'commit',
    Boolean(handle) && afterAsk?.state === 'review' && store.state.approvals.length === 1,
    `handle ${handle ?? 'none'} | still ${afterAsk?.state} | ${store.state.approvals.length} waiting`,
  )

  const chk = await call('check_approval', { handle: handle ?? 'none' })
  report('check_approval says pending', 'work, read only', /waiting on a human/.test(chk.text), chk.text)

  // 6. a human approves, and only now does anything happen
  const approval = store.state.approvals[0]
  if (approval) await settleApproval({ store, def: campaign, approval, by: STEWARD, ok: true })
  const done = store.state.items.find(i => i.id === 'post_1')
  report(
    'approval applies the effect', 'human in the loop',
    done?.state === 'done' && store.state.approvals.length === 0,
    `post_1 is now ${done?.state} | ${store.state.approvals.length} waiting`,
  )

  const chk2 = await call('check_approval', { handle: handle ?? 'none' })
  report('check_approval says approved', 'work, read only', /approved/.test(chk2.text), chk2.text)

  // 7. the member's own computer. Same claim as the draft, on a filesystem.
  const CANARY = 'canary sentence that must never leave this computer'
  const wf = await call('computer_write_file', { path: 'notes.md', content: CANARY })
  const computerUp = !/Could not/.test(wf.text)
  report('computer_write_file', 'work, on your machine', computerUp && /Wrote/.test(wf.text), wf.text)
  if (computerUp) {
    const ran = await call('computer_run', { command: 'cat notes.md && wc -w notes.md' })
    report('computer_run', 'work, on your machine', /exit 0/.test(ran.text) && ran.text.includes(CANARY), ran.text)

    const leaked2 = JSON.stringify({ items: store.state.items, events: store.state.events })
    report(
      'the file never reaches shared state', 'the whole point, again',
      !leaked2.includes(CANARY),
      leaked2.includes(CANARY) ? 'FAILED: file contents found in shared state' : 'shared state holds "ran a command" and "wrote notes.md", not the file',
    )

    const shared = await call('computer_share_file', { path: 'notes.md', title: 'Notes' })
    const onBoard = store.state.items.find(i => i.id === 'file_notes_md')
    report(
      'computer_share_file', 'share, by choice',
      Boolean(onBoard) && JSON.stringify(onBoard?.body).includes(CANARY),
      `${shared.text} | on board: ${onBoard ? 'yes' : 'no'}`,
    )

    // A server that keeps running, a page fetched from inside the machine,
    // and the moment that page is chosen for the board.
    const PAGE = 'page sentence that stays behind the port until shared'
    await call('computer_write_file', { path: 'site/index.html', content: `<h1>Pricing</h1><p>${PAGE}</p>` })
    const served = await call('computer_serve', { command: 'python3 -m http.server 8000 -d site', port: 8000 })
    report('computer_serve', 'work, a background process', /listening on port 8000/.test(served.text), served.text)
    const fetched = await call('computer_fetch_local', { port: 8000, path: '/' })
    const leaked3 = JSON.stringify({ items: store.state.items, events: store.state.events })
    report(
      'computer_fetch_local', 'work, on your machine',
      /HTTP 200/.test(fetched.text) && fetched.text.includes(PAGE) && !leaked3.includes(PAGE),
      `${fetched.text.split('\n')[0]} | page in shared state: ${leaked3.includes(PAGE) ? 'YES, FAILED' : 'no'}`,
    )
    const page = await call('computer_share_page', { port: 8000, path: '/', title: 'Pricing page' })
    const pageItem = store.state.items.find(i => i.id.startsWith('page_8000'))
    report(
      'computer_share_page', 'share, by choice',
      Boolean(pageItem) && JSON.stringify(pageItem?.body).includes(PAGE),
      `${page.text} | on board: ${pageItem ? 'yes' : 'no'}`,
    )

    // Snapshot, destroy the workspace, restore, and the canary is back.
    const snap = await call('computer_snapshot', { name: 'selftest' })
    await call('computer_run', { command: 'rm -rf /workspace/notes.md /workspace/site' })
    const gone = await call('computer_read_file', { path: 'notes.md' })
    const restored = await call('computer_restore', { name: 'selftest' })
    const back = await call('computer_read_file', { path: 'notes.md' })
    report(
      'computer_snapshot and computer_restore', 'work, on your machine',
      /Saved snapshot/.test(snap.text) && !gone.text.includes(CANARY) && /Restored/.test(restored.text) && back.text.includes(CANARY),
      `${snap.text} | after rm: ${gone.text.includes(CANARY) ? 'still there?!' : 'gone'} | ${restored.text} | after restore: ${back.text.includes(CANARY) ? 'canary is back' : 'MISSING'}`,
    )
  }

  // 7b. tools the room borrowed. Same tier rules, on an API the room had
  //     never heard of when it was built.
  const parsed = await inspectSource(store, `${location.origin}/api/demo/openapi.json`)
  const src = parsed.error ? null : addSourceAsHuman(store, parsed, ME.id)
  report(
    'a source becomes tools', 'borrowed, after a person said yes',
    Boolean(src) && (src?.tools.length ?? 0) === 4,
    src ? `${src.name}: ${src.tools.map(t => `${t.tier} ${t.name}`).join(', ')}` : String(parsed.error),
  )

  if (src) {
    await host.mount(campaign, { store, me: ME, isSteward: false })
    const listName = src.tools.map(t => sourceToolName(src, t)).find(n => n.endsWith('list_orders'))!
    const refundName = src.tools.map(t => sourceToolName(src, t)).find(n => n.endsWith('refund_order'))!

    const listed = await call(listName, {})
    const leaked3 = JSON.stringify({ items: store.state.items, events: store.state.events })
    report(
      'a borrowed read stays out of shared state', 'work, borrowed',
      /HTTP 200/.test(listed.text) && listed.text.includes('Rowan Bakery') && !leaked3.includes('Rowan Bakery'),
      `${listed.text.split('\n')[0]} | on the board: ${leaked3.includes('Rowan Bakery') ? 'YES, FAILED' : 'no'}`,
    )

    const asked = await call(refundName, { id: 'HF-1041', amount: 5, reason: 'self test' })
    const handle2 = String((asked.data as { approvalId?: string } | undefined)?.approvalId ?? '')
    const stillOpen = !JSON.stringify(store.state.items).includes('refund')
    report(
      'a borrowed refund parks', 'commit, borrowed',
      /PENDING APPROVAL/.test(asked.text) && stillOpen,
      `handle ${handle2 || 'none'} | nothing on the board yet: ${stillOpen}`,
    )

    const waiting2 = store.state.approvals.find(a => a.id === handle2)
    if (waiting2) {
      await settleApproval({ store, def: campaign, approval: waiting2, by: STEWARD, ok: true })
    }
    const applied = store.state.items.find(i => i.title.includes('refund'))
    report(
      'and applies once a person approves', 'human in the loop, borrowed',
      Boolean(applied) && JSON.stringify(applied?.body).includes('refunded'),
      applied ? `${applied.title} is ${applied.state}` : 'nothing landed on the board',
    )
    await host.mount(campaign, { store, me: ME, isSteward: false })
  }

  // 8. the steward's view, and what it cannot see
  await host.mount(campaign, { store, me: STEWARD, isSteward: true })
  const log = await call('read_work_log', {})
  report(
    'the work log shows work, never words', 'steward',
    /drafted variant/.test(log.text) && !log.text.includes(SECRET),
    log.text,
  )

  if ($('tally')) {
    $('tally')!.innerHTML =
      `<span class="verdict ${passed === total ? 'p' : 'f'}">${passed}/${total} passed</span>` +
      `<span class="dim"> on ${namespaceName()}.modelContext</span>`
  }
  ;(window as any).__selftest = { passed, total }
}

main().catch(err => {
  if ($('tally')) $('tally')!.innerHTML = `<span class="verdict f">threw</span> ${String(err?.message ?? err)}`
  ;(window as any).__selftest = { error: String(err?.message ?? err) }
})
