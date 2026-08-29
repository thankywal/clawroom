// The room. One layout for every workplace, because a room is data.
//
// Two things on this page are arguments rather than decoration. The tool strip
// shows the live result of getTools(), so switching rooms visibly changes what
// the agents in the room can do. And the log is rendered from engine events
// only, never from anything a model claims it did, which is why a model that
// narrates a publish it never called leaves a visibly empty line.

import type { Approval, Event, Person, RoomDefinition, WorkItem } from '../types.js'
import type { RoomStore } from '../engine/store.js'
import { createStore } from '../engine/store.js'
import { createToolHost, namespaceName } from '../engine/webmcp.js'
import { settleApproval } from '../engine/tiers.js'
import { evaluateSignals } from '../engine/signals.js'
import { clearPrivate, me, scratchFor } from '../engine/identity.js'
import { roomById } from '../rooms/index.js'

const q = new URLSearchParams(location.search)
const def: RoomDefinition = roomById(q.get('room'))
const instance = q.get('r') ?? 'demo'
const isSteward = q.get('as') === 'steward'
const roomKey = `${def.id}/${instance}`

const person: Person = isSteward
  ? { ...me(), name: me().name, colour: '#a980e0' }
  : me()

const store: RoomStore = createStore({
  def, roomKey, me: person, role: isSteward ? 'steward' : 'member',
})

const host = createToolHost()
let surface: string[] = []

const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const el = (id: string) => document.getElementById(id)

const nameOf = (id: string): Person =>
  store.state.members.find(p => p.id === id)
  ?? (store.state.steward.id === id ? store.state.steward : { id, name: id.slice(0, 6), colour: '#7e9998' })

const TIER_MARK: Record<string, string> = { work: 'local', share: 'shared', commit: 'commit' }

function boardRow(i: WorkItem): string {
  const b = i.body as Record<string, unknown>
  const headline = typeof b['headline'] === 'string' && b['headline'] ? b['headline'] : ''
  const brief = typeof b['brief'] === 'string' ? b['brief'] : ''
  const owner = i.owner ? nameOf(i.owner) : null
  return `<tr>
    <td class="opt">${esc(i.title)}${headline ? `<br><span class="meta">${esc(headline)}</span>` : ''}</td>
    <td class="meta">${esc(brief)}</td>
    <td><span class="state s-${i.state}">${i.state}</span></td>
    <td class="meta">${owner ? `<span style="color:${owner.colour}">${esc(owner.name)}</span>` : ''}</td>
  </tr>`
}

function logRow(e: Event): string {
  const who = nameOf(e.actor)
  return `<div class="ev">
    <span class="who" style="color:${who.colour}">${esc(who.name)}</span>
    <span class="zn">${e.kind === 'human' ? 'person' : TIER_MARK[e.tier] ?? e.tier}</span>
    <span class="what">${esc(e.tool)}</span>
    <span class="det">${esc(e.summary)}</span>
  </div>`
}

function approvalRow(a: Approval): string {
  const who = nameOf(a.requestedBy)
  return `<div class="ask">
    <h3><span style="color:${who.colour}">${esc(who.name)}</span> asked to ${esc(a.describe)}</h3>
    <p class="dim">${a.id}, waiting since ${new Date(a.at).toLocaleTimeString()}</p>
    ${isSteward ? `<div class="btns">
      <button class="primary" data-ok="${a.id}">Approve</button>
      <button class="ghost" data-no="${a.id}">Decline</button>
    </div>` : '<p class="dim">Only a person in this room can approve. No agent has that tool.</p>'}
  </div>`
}

function render(): void {
  const s = store.state
  const mount = el('room')
  if (!mount) return

  const drafts = scratchFor(roomKey, person.id).keys().length
  const fired = evaluateSignals(s)

  mount.innerHTML = `
    <div class="bar">
      <span class="pill"><i style="background:${person.colour}"></i>${esc(person.name)}</span>
      <span class="pill">${esc(isSteward ? def.stewardRole : def.memberRole)}</span>
      <span class="pill">${esc(def.title)}</span>
      <button class="ghost small" id="share">Copy invite link</button>
      <span class="status ${host.available ? 'live' : ''}">${
        host.available
          ? `${surface.length} tools on ${namespaceName()}.modelContext`
          : 'WebMCP unavailable, enable chrome://flags/#enable-webmcp-testing'
      }</span>
    </div>

    <div class="tools">${surface.map(n => `<span class="chip">${esc(n)}</span>`).join('') || '<span class="dim">no tools mounted</span>'}</div>

    ${fired.length ? `<div class="banner warn">${fired.map(f => `<b>${esc(f.label)}.</b> ${esc(f.text)}`).join('<br>')}</div>` : ''}

    ${s.approvals.length ? s.approvals.map(approvalRow).join('') : ''}

    <div class="grid">
      <section class="zone">
        <div class="zhead"><h2>The board</h2><span class="note">everyone sees this</span></div>
        <div class="zbody">
          <table><thead><tr><th>Item</th><th>Brief</th><th>State</th><th>Owner</th></tr></thead>
          <tbody>${s.items.map(boardRow).join('')}</tbody></table>
        </div>
      </section>

      <section class="zone priv">
        <div class="zhead"><h2>On this machine</h2><span class="note">never synced</span></div>
        <div class="zbody">
          <p>${drafts ? `${drafts} private working file${drafts > 1 ? 's' : ''}.` : 'Nothing private yet.'}</p>
          <p class="empty">Work-tier tools keep their payload here. The room gets a summary
            line and nothing else, and no tool in the engine can return this.</p>
          ${drafts ? '<div class="btns"><button class="ghost small" id="wipe">Delete everything the room never had</button></div>' : ''}
        </div>
      </section>
    </div>

    <section class="zone" style="margin-top:14px">
      <div class="zhead"><h2>Work log</h2><span class="note">what happened, never what was said</span></div>
      <div id="feed">${s.events.length ? s.events.slice(-60).map(logRow).join('') : '<p class="empty">Nothing yet.</p>'}</div>
    </section>`

  const feed = el('feed')
  if (feed) feed.scrollTop = feed.scrollHeight

  el('share')?.addEventListener('click', async () => {
    const url = `${location.origin}/room.html?room=${def.id}&r=${instance}`
    try { await navigator.clipboard.writeText(url) } catch { /* clipboard can be blocked */ }
    const b = el('share')
    if (b) { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy invite link' }, 1500) }
  })

  el('wipe')?.addEventListener('click', () => { clearPrivate(roomKey, person.id); render() })

  for (const b of Array.from(mount.querySelectorAll<HTMLElement>('[data-ok],[data-no]'))) {
    b.addEventListener('click', () => {
      const id = b.dataset['ok'] ?? b.dataset['no']
      const approval = store.state.approvals.find(a => a.id === id)
      if (approval) settleApproval({ store, def, approval, by: person, ok: Boolean(b.dataset['ok']) })
    })
  }
}

async function boot(): Promise<void> {
  document.title = `${def.title} — ClawRoom`
  store.subscribe(render)
  store.seedIfFirst(true)
  surface = await host.mount(def, { store, me: person, isSteward })
  render()
}

boot().catch(err => {
  const mount = el('room')
  if (mount) mount.innerHTML = `<div class="banner warn">Could not start this room: ${esc(String(err?.message ?? err))}</div>`
})
