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
import { rememberRoom, roomLink, roomMeta, savedRooms, type SavedRoom } from '../engine/rooms-local.js'
import { createAgent, systemPrompt, toolSpecs, type Agent } from '../agent/agent.js'
import { resolveModelContext } from '../engine/webmcp.js'
import { connectRoom, type Status, type Transport } from '../sync/client.js'

const q = new URLSearchParams(location.search)
const roomId = q.get('r') ?? ''
const secret = q.get('k') ?? ''

const person: Person = me()

// The role is not read from the URL. It comes back from the server, which
// decides what the secret in the link is worth. Until then, assume the least.
let isSteward = false
let def: RoomDefinition = roomById(q.get('room'))
let roomKey = `${roomId}`
let store: RoomStore = createStore({ def, roomKey, me: person, role: 'member' })

// Chat lines are the only thing on this page written from what a model said.
// Tool chips are not: they come from onCall, which only fires when a tool
// actually ran. A model claiming a publish it never called leaves a gap.
type Line =
  | { k: 'you'; text: string }
  | { k: 'agent'; text: string }
  | { k: 'tool'; name: string; tier: string; summary: string; pending: boolean }
  | { k: 'note'; text: string }

const chat: Line[] = []
let thinking = false

const host = createToolHost({
  onCall: (r) => {
    chat.push({
      k: 'tool', name: r.name, tier: r.tier,
      summary: r.outcome.summary ?? r.outcome.text.slice(0, 80),
      pending: Boolean(r.outcome.pending),
    })
    render()
  },
})
let surface: string[] = []
let agent: Agent | null = null
let link: Transport | null = null
let linkStatus: Status = 'connecting'
let denied = false
let invite: string | null = null
/** The name the creator gave this room, which is not the template's name. */
let roomTitle = ''

async function inviteLink(): Promise<string | null> {
  if (invite) return invite
  const meta = await roomMeta(roomId, secret)
  if (meta?.invite) invite = roomLink(roomId, meta.invite)
  return invite
}

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

  if (denied) {
    mount.innerHTML = `<div class="banner warn">
      <b>This link does not open that room.</b> Room links carry their own key, and
      the key is what decides whether you can approve things. Ask whoever created
      the room to send you theirs, or <a href="/">start one of your own</a>.</div>`
    return
  }

  const drafts = scratchFor(roomKey, person.id).keys().length
  const fired = evaluateSignals(s)

  mount.innerHTML = `
    <div class="bar">
      <span class="pill"><i style="background:${person.colour}"></i>${esc(person.name)}</span>
      <span class="pill">${esc(isSteward ? def.stewardRole : def.memberRole)}</span>
      <span class="pill">${esc(roomTitle || def.title)}</span>
      <select id="switch" aria-label="Switch room">
        ${savedRooms().map(r => `<option value="${r.roomId}" ${r.roomId === roomId ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}
        <option value="__new">New room...</option>
      </select>
      <button class="ghost small" id="share">Copy invite link</button>
      <span class="status ${host.available ? 'live' : ''}">${
        host.available
          ? `${surface.length} tools on ${namespaceName()}.modelContext`
          : 'WebMCP unavailable, enable chrome://flags/#enable-webmcp-testing'
      }</span>
      <span class="status ${linkStatus === 'open' ? 'live' : ''}">${
        linkStatus === 'open' ? `live, ${s.members.length} in the room` : linkStatus
      }</span>
    </div>

    <div class="tools">${surface.map(n => `<span class="chip">${esc(n)}</span>`).join('') || '<span class="dim">no tools mounted</span>'}</div>

    ${fired.length ? `<div class="banner warn">${fired.map(f => `<b>${esc(f.label)}.</b> ${esc(f.text)}`).join('<br>')}</div>` : ''}

    ${s.approvals.map(approvalRow).join('')}

    <div class="grid">
      <div>
        <section class="zone priv chatzone">
          <div class="zhead">
            <h2>Your agent</h2>
            <span class="note">${host.available ? 'this conversation stays here' : 'WebMCP unavailable'}</span>
          </div>
          <div id="chat">${chat.length ? chat.map(chatLine).join('') : `<p class="empty">Ask for something. Try: ${esc(suggestion())}</p>`}</div>
          <div class="composer">
            <input id="say" placeholder="Tell your agent what to do" ${thinking ? 'disabled' : ''}>
            <button class="primary" id="send" ${thinking ? 'disabled' : ''}>${thinking ? 'Working' : 'Send'}</button>
            ${thinking ? '<button class="ghost" id="halt">Stop</button>' : ''}
          </div>
        </section>

        <section class="zone priv" style="margin-top:14px">
          <div class="zhead"><h2>On this machine</h2><span class="note">never synced</span></div>
          <div class="zbody">
            <p>${drafts ? `${drafts} private working file${drafts > 1 ? 's' : ''}.` : 'Nothing private yet.'}</p>
            <p class="empty">Work-tier tools keep their payload here. The room gets a summary
              line and nothing else, and no tool in this engine can return it.</p>
            ${drafts ? '<div class="btns"><button class="ghost small" id="wipe">Delete everything the room never had</button></div>' : ''}
          </div>
        </section>
      </div>

      <section class="zone">
        <div class="zhead"><h2>${esc(roomTitle || def.title)}</h2><span class="note">everyone in the room sees this</span></div>
        <div class="zbody">
          <table><thead><tr><th>Item</th><th>Brief</th><th>State</th><th>Owner</th></tr></thead>
          <tbody>${s.items.map(boardRow).join('')}</tbody></table>
        </div>
      </section>
    </div>

    <section class="zone" style="margin-top:14px">
      <div class="zhead"><h2>Work log</h2><span class="note">what happened, never what was said</span></div>
      <div id="feed">${s.events.length ? s.events.slice(-60).map(logRow).join('') : '<p class="empty">Nothing yet.</p>'}</div>
    </section>`

  const feed = el('feed')
  if (feed) feed.scrollTop = feed.scrollHeight
  const chatBox = el('chat')
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight
  wireComposer()

  el('share')?.addEventListener('click', async () => {
    const b = el('share')
    const invite = await inviteLink()
    if (!invite) { if (b) b.textContent = 'Steward link only'; return }
    try { await navigator.clipboard.writeText(invite) } catch { /* clipboard can be blocked */ }
    if (b) { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy invite link' }, 1600) }
  })

  el('wipe')?.addEventListener('click', () => { clearPrivate(roomKey, person.id); render() })

  el('switch')?.addEventListener('change', e => {
    const v = (e.target as HTMLSelectElement).value
    if (v === '__new') { location.href = '/'; return }
    switchRoom(v)
  })

  for (const b of Array.from(mount.querySelectorAll<HTMLElement>('[data-ok],[data-no]'))) {
    b.addEventListener('click', () => {
      const id = b.dataset['ok'] ?? b.dataset['no']
      const approval = store.state.approvals.find(a => a.id === id)
      if (approval) settleApproval({ store, def, approval, by: person, ok: Boolean(b.dataset['ok']) })
    })
  }
}

function suggestion(): string {
  return isSteward
    ? 'What has happened in here, and is anything waiting on me?'
    : 'Draft two options for the launch announcement, then submit the better one.'
}

function chatLine(l: Line): string {
  if (l.k === 'you')   return `<div class="line you"><b>${esc(person.name)}</b> ${esc(l.text)}</div>`
  if (l.k === 'agent') return `<div class="line agent">${esc(l.text)}</div>`
  if (l.k === 'note')  return `<div class="line note">${esc(l.text)}</div>`
  return `<div class="line call ${l.pending ? 'pending' : ''}">
    <span class="zn">${esc(l.tier)}</span>
    <span class="what">${esc(l.name)}</span>
    <span class="det">${esc(l.summary)}</span>
  </div>`
}

function wireComposer(): void {
  const input = el('say') as HTMLInputElement | null
  const send = () => {
    const text = input?.value.trim()
    if (!text || !agent || thinking) return
    input!.value = ''
    chat.push({ k: 'you', text })
    thinking = true
    render()
    void agent.send(text)
  }
  el('send')?.addEventListener('click', send)
  input?.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') send() })
  el('halt')?.addEventListener('click', () => agent?.stop())
  if (thinking) return
  input?.focus()
}

/**
 * Switching rooms means going to a different room you hold a link to, so it is
 * a navigation rather than a swap in place. Each room is its own Durable
 * Object with its own key, and pretending otherwise would mean holding several
 * rooms' credentials live in one page for no benefit.
 */
function switchRoom(id: string): void {
  if (id === roomId) return
  const saved: SavedRoom | undefined = savedRooms().find(r => r.roomId === id)
  if (saved) location.href = roomLink(saved.roomId, saved.secret)
}

async function connect(): Promise<void> {
  store.subscribe(render)

  link = connectRoom({
    roomId,
    secret,
    since: () => store.lastSeq(),
    onEnvelope: env => store.receive(env),
    onWelcome: async w => {
      const changed = w.role === 'steward' !== isSteward
      isSteward = w.role === 'steward'
      if (w.defId && w.defId !== def.id) {
        def = roomById(w.defId)
        store = createStore({ def, roomKey, me: person, role: w.role })
        store.subscribe(render)
        store.setSink(env => link?.send(env))
      }
      if (changed || !surface.length) {
        surface = await host.mount(def, { store, me: person, isSteward })
      }
      roomTitle = w.title ?? def.title
      document.title = `${roomTitle} · ClawRoom`
      rememberRoom({
        roomId, secret, defId: def.id, role: w.role, at: Date.now(),
        title: w.title ?? def.title,
      })
      // Whatever the creator typed in the lobby, written in on first connect.
      // The server never carried it.
      let pending: WorkItem[] = []
      try {
        pending = JSON.parse(localStorage.getItem(`clawroom:pending:${roomId}`) ?? '[]')
      } catch { /* nothing pending is the normal case */ }
      store.seedIfFirst(w.first, pending)
      if (w.first) localStorage.removeItem(`clawroom:pending:${roomId}`)
      render()
    },
    onDenied: () => { denied = true; render() },
    onRefused: need => {
      chat.push({ k: 'note', text: `The room refused that. It needs the ${need} link.` })
      render()
    },
    onStatus: st => { linkStatus = st; render() },
  })
  store.setSink(env => link?.send(env))

  surface = await host.mount(def, { store, me: person, isSteward })

  const mc = resolveModelContext()
  if (mc) {
    agent = createAgent({
      mc, host,
      specs: () => toolSpecs(def, store, isSteward),
      system: () => systemPrompt(def, person, isSteward),
      events: {
        onAssistant: (text) => { chat.push({ k: 'agent', text }); render() },
        onDone: (reason, detail) => {
          thinking = false
          if (reason === 'error') chat.push({ k: 'note', text: detail ?? 'The agent could not be reached.' })
          if (reason === 'limit') chat.push({ k: 'note', text: 'Stopped after too many steps in one go.' })
          render()
        },
      },
    })
  }
}

async function boot(): Promise<void> {
  await connect()
  render()
}

boot().catch(err => {
  const mount = el('room')
  if (mount) mount.innerHTML = `<div class="banner warn">Could not start this room: ${esc(String(err?.message ?? err))}</div>`
})
