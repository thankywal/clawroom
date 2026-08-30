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
import { computerCounters, destroyComputer } from '../engine/computer.js'
import { computerUsage } from '../engine/signals.js'
import { addSourceAsHuman, inspectSource, removeSource, sourceFingerprint, sourceToolName } from '../engine/sources.js'
import { roomById } from '../rooms/index.js'
import { answerDoor, deleteRoom, forgetRoom, rememberRoom, roomLink, roomMeta, rotateInvite, savedRooms, setDoor, type SavedRoom } from '../engine/rooms-local.js'
import { createAgent, systemPrompt, toolSpecs, type Agent } from '../agent/agent.js'
import { REHEARSAL_NOTE, rehearsedPlan } from '../agent/rehearsed.js'
import { PRESETS, providerLabel, saveProvider, savedProvider } from '../agent/provider.js'
import { resolveModelContext } from '../engine/webmcp.js'

/** What a person typed into their own computer's console, and what came back.
 *  It goes through the same WebMCP tool the agent uses, so it lands in the
 *  same log line: "ran ...", never the output. */
/** What the Add a source form is holding: nothing, a URL being read, or a
 *  parsed source waiting for the person to say yes. */
let sourceDraft: { url: string; busy: boolean; parsed?: any; error?: string } | null = null
let modelOpen = false
/** Set when this browser is outside a door that is set to ask. */
let waitingOutside = false
let door: 'open' | 'ask' = 'open'
let knocking: Knocker[] = []
let sourcePrint = ''

const tty: { cmd: string; out: string }[] = []
let ttyBusy = false
import { connectRoom, type Knocker, type Status, type Transport } from '../sync/client.js'

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

let remounting = false

/**
 * The tool surface follows shared state.
 *
 * When a person approves a source, the op reaches every browser in the room,
 * and every browser remounts. So document.modelContext changes for everyone
 * at the same moment, and an agent that had asked for the tools a minute ago
 * gets them without anybody reloading. It is the one part of this room's
 * surface that is not decided by the code we shipped, which is exactly what
 * the API's ontoolchange event exists for.
 */
async function watchSources(): Promise<void> {
  const print = sourceFingerprint(store.state)
  if (print === sourcePrint || remounting) return
  sourcePrint = print
  remounting = true
  try {
    surface = await host.mount(def, { store, me: person, isSteward })
  } finally {
    remounting = false
  }
  render()
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

  if (waitingOutside) {
    mount.innerHTML = `<div class="banner">
      <b>Waiting to be let in.</b> This room is set so that the person who runs it admits
      each arrival, so your link is not the whole answer here. They can see that
      ${esc(person.name)} is at the door. This page will open by itself the moment they say yes.
      </div>
      <p class="empty">Your name here comes from this tab. If you would rather knock as somebody
      else, add <code>&amp;as=Name</code> to the link and reload.</p>`
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
      ${isSteward ? `<button class="ghost small" id="rotate" title="Mint a new member link. The old one stops working now.">Rotate invite</button>
      <button class="ghost small danger" id="delete" title="Delete this room for everyone.">Delete room</button>` : ''}
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

    ${isSteward && linkStatus === 'open' && !s.members.length ? `<div class="banner">
      <b>Nobody else is here yet.</b> You are the ${esc(def.stewardRole)}, and the ${esc(def.stewardRole)} reads the room
      rather than working in it, so the working tools are not on this page. Press <b>Copy invite link</b> and open it in
      another browser, or in a new tab here with <code>&amp;as=Name</code> on the end. That person joins as a
      ${esc(def.memberRole)} with the ${esc(def.memberRole)}'s tools, and their work shows up in your log.
    </div>` : ''}

    ${fired.length ? `<div class="banner warn">${fired.map(f => `<b>${esc(f.label)}.</b> ${esc(f.text)}`).join('<br>')}</div>` : ''}

    ${isSteward ? `<section class="zone" style="margin-bottom:14px">
      <div class="zhead">
        <h2>Who gets in</h2>
        <span class="note">${door === 'ask' ? 'you admit each arrival' : 'anyone with the invite link'}</span>
      </div>
      <div class="zbody">
        ${knocking.length ? `<table class="usage"><thead><tr><th>At the door</th><th>Since</th><th></th></tr></thead>
          <tbody>${knocking.map(k => `<tr>
            <td>${esc(k.name)}</td>
            <td>${new Date(k.at).toLocaleTimeString()}</td>
            <td><button class="ghost small" data-admit="${esc(k.id)}">Let them in</button>
                <button class="ghost small danger" data-refuse="${esc(k.id)}">Turn away</button></td>
          </tr>`).join('')}</tbody></table>` : `<p class="empty">${door === 'ask' ? 'Nobody is waiting.' : 'The invite link is the whole gate. Anyone holding it walks in.'}</p>`}
        <div class="btns">
          <button class="ghost small" id="doortoggle">${door === 'ask' ? 'Let anyone with the link in' : 'Ask me before letting anyone in'}</button>
        </div>
      </div>
    </section>` : ''}

    ${s.approvals.map(approvalRow).join('')}

    ${isSteward && computerUsage(s).length ? `<section class="zone" style="margin-bottom:14px">
      <div class="zhead"><h2>Computers in this room</h2><span class="note">counts, never contents</span></div>
      <div class="zbody">
        <table class="usage"><thead><tr><th>member</th><th>commands</th><th>failed</th><th>files written</th><th>shared</th><th>last</th></tr></thead>
        <tbody>${computerUsage(s).map(u => `<tr><td>${esc(u.name)}</td><td>${u.runs}</td><td>${u.failed}</td><td>${u.writes}</td><td>${u.shares}</td><td>${new Date(u.last).toLocaleTimeString()}</td></tr>`).join('')}</tbody></table>
      </div>
    </section>` : ''}

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
          <p class="empty modelrow">
            Model: <b>${esc(providerLabel())}</b>
            <button class="linky" id="modeltoggle">${modelOpen ? 'close' : savedProvider() ? 'change' : 'use your own'}</button>
          </p>
          ${modelOpen ? `<div class="modelform">
            <p class="empty">Any OpenAI-compatible endpoint. The key stays in this browser and is sent with
              each request to this site, which forwards it to the endpoint you name and keeps nothing.
              It never reaches the room or another member. Use a scoped or throwaway key.</p>
            <select id="mpreset">${PRESETS.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}</select>
            <input id="mbase" placeholder="https://api.openai.com/v1" value="${esc(savedProvider()?.base ?? PRESETS[0]!.base)}">
            <input id="mmodel" placeholder="gpt-5" value="${esc(savedProvider()?.model ?? PRESETS[0]!.model)}">
            <input id="mkey" type="password" placeholder="your key" autocomplete="off">
            <div class="btns">
              <button class="primary small" id="msave">Use this model</button>
              ${savedProvider() ? '<button class="ghost small" id="mclear">Back to the built in one</button>' : ''}
            </div>
          </div>` : ''}
        </section>

        <section class="zone priv" style="margin-top:14px">
          <div class="zhead"><h2>On this machine</h2><span class="note">never synced</span></div>
          <div class="zbody">
            <p>${drafts ? `${drafts} private working file${drafts > 1 ? 's' : ''}.` : 'Nothing private yet.'}</p>
            ${(() => { const c = computerCounters(scratchFor(roomKey, person.id)); return c.runs || c.writes
              ? `<p>Your computer: ${c.runs} command${c.runs === 1 ? '' : 's'} run, ${c.writes} file${c.writes === 1 ? '' : 's'} written. The room saw the counts, not the contents.</p>`
              : '' })()}
            <p class="empty">Work-tier tools keep their payload here. The room gets a summary
              line and nothing else, and no tool in this engine can return it.</p>
            ${drafts ? '<div class="btns"><button class="ghost small" id="wipe">Delete everything the room never had</button></div>' : ''}
          </div>
        </section>

        ${!isSteward && host.available ? `<section class="zone priv" style="margin-top:14px">
          <div class="zhead"><h2>Your computer</h2><span class="note">a Linux machine on Cloudflare, yours alone</span></div>
          <div class="zbody">
            <pre class="tty" id="tty">${tty.length ? tty.map(t => `<b>$ ${esc(t.cmd)}</b>\n${esc(t.out)}`).join('\n') : 'Type a command. It runs on the same computer your agent uses, through the same computer_run tool, so the room sees one log line and nothing else.'}</pre>
            <div class="composer">
              <input id="cmd" placeholder="ls -la /workspace" ${ttyBusy ? 'disabled' : ''}>
              <button class="ghost" id="runcmd" ${ttyBusy ? 'disabled' : ''}>${ttyBusy ? 'Running' : 'Run'}</button>
            </div>
          </div>
        </section>` : ''}
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
      <div class="zhead">
        <h2>Borrowed tools</h2>
        <span class="note">${s.sources.length ? `${s.sources.length} source${s.sources.length === 1 ? '' : 's'}, everyone in the room has them` : 'anything this room borrowed from elsewhere'}</span>
      </div>
      <div class="zbody">
        ${s.sources.length ? `<table class="usage"><thead><tr><th>Source</th><th>Kind</th><th>Tools</th><th>Added by</th>${isSteward ? '<th></th>' : ''}</tr></thead>
          <tbody>${s.sources.map(src => `<tr>
            <td title="${esc(src.url)}">${esc(src.name)}</td>
            <td>${esc(src.kind)}</td>
            <td>${src.tools.length ? esc(src.tools.map(t => sourceToolName(src, t)).slice(0, 3).join(', ')) + (src.tools.length > 3 ? ` and ${src.tools.length - 3} more` : '') : esc(src.note ?? 'none')}</td>
            <td>${esc(nameOf(src.addedBy).name)}</td>
            ${isSteward ? `<td><button class="ghost small danger" data-drop="${esc(src.id)}">Remove</button></td>` : ''}
          </tr>`).join('')}</tbody></table>` : ''}

        ${sourceDraft?.parsed ? `<div class="banner">
          <b>${esc(String(sourceDraft.parsed.name ?? sourceDraft.url))}</b> (${esc(String(sourceDraft.parsed.kind))}):
          ${(sourceDraft.parsed.tools ?? []).length} tools.
          ${sourceDraft.parsed.note ? `<br>${esc(String(sourceDraft.parsed.note))}` : ''}
          <div class="srclist">${(sourceDraft.parsed.tools ?? []).slice(0, 14).map((t: any) => `<span class="chip ${esc(t.tier)}">${esc(t.tier)} ${esc(t.name)}</span>`).join('')}</div>
          <div class="btns">
            <button class="primary small" id="srcadd">${isSteward ? 'Add to the room' : 'Ask the ' + esc(def.stewardRole) + ' to add it'}</button>
            <button class="ghost small" id="srccancel">Cancel</button>
          </div>
        </div>` : ''}
        ${sourceDraft?.error ? `<p class="empty">${esc(sourceDraft.error)}</p>` : ''}

        <div class="composer">
          <input id="srcurl" placeholder="https://api.example.com/openapi.json, or an MCP server URL" value="${esc(sourceDraft?.url ?? '')}" ${sourceDraft?.busy ? 'disabled' : ''}>
          <button class="ghost" id="srcread" ${sourceDraft?.busy ? 'disabled' : ''}>${sourceDraft?.busy ? 'Reading' : 'Read it'}</button>
        </div>
        <p class="empty">Reads an OpenAPI document or a remote MCP server and turns its operations into
          tools for this room, tiered the same way as everything else. ${isSteward
            ? 'You can add one because you are a person, not an agent. An agent can only propose one, through <code>add_tool_source</code>, and it parks here for you.'
            : `Yours goes to the ${esc(def.stewardRole)} as an approval. Nothing registers until they say yes, and then everyone in the room gets it at once.`}</p>
      </div>
    </section>

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

  el('doortoggle')?.addEventListener('click', async () => {
    const next = door === 'ask' ? 'open' : 'ask'
    if (await setDoor(roomId, secret, next)) { door = next; render() }
  })
  for (const b of Array.from(document.querySelectorAll('[data-admit],[data-refuse]')) as HTMLElement[]) {
    b.addEventListener('click', async () => {
      const admit = b.dataset['admit']
      const refuse = b.dataset['refuse']
      const id = admit ?? refuse
      if (!id) return
      b.textContent = 'Working'
      await answerDoor(roomId, secret, id, Boolean(admit))
      knocking = knocking.filter(k => k.id !== id)
      render()
    })
  }

  el('modeltoggle')?.addEventListener('click', () => { modelOpen = !modelOpen; render() })
  el('mpreset')?.addEventListener('change', e => {
    const p = PRESETS[Number((e.target as HTMLSelectElement).value)]
    if (!p) return
    ;(el('mbase') as HTMLInputElement).value = p.base
    ;(el('mmodel') as HTMLInputElement).value = p.model
  })
  el('msave')?.addEventListener('click', () => {
    const base = (el('mbase') as HTMLInputElement | null)?.value.trim() ?? ''
    const model = (el('mmodel') as HTMLInputElement | null)?.value.trim() ?? ''
    const key = (el('mkey') as HTMLInputElement | null)?.value.trim() ?? ''
    if (!base || !model || !key) {
      chat.push({ k: 'note', text: 'That needs an endpoint, a model name and a key.' })
      render()
      return
    }
    saveProvider({ base, model, key })
    modelOpen = false
    chat.push({ k: 'note', text: `Your agent will use ${model} from now on, in this browser only.` })
    render()
  })
  el('mclear')?.addEventListener('click', () => {
    saveProvider(null)
    modelOpen = false
    chat.push({ k: 'note', text: 'Back to the model this site hosts.' })
    render()
  })

  const srcBox = el('srcurl') as HTMLInputElement | null
  const readSource = async (): Promise<void> => {
    const url = srcBox?.value.trim()
    if (!url) return
    sourceDraft = { url, busy: true }
    render()
    const parsed = await inspectSource(store, url)
    sourceDraft = parsed.error
      ? { url, busy: false, error: String(parsed.error) }
      : { url, busy: false, parsed }
    render()
  }
  el('srcread')?.addEventListener('click', () => { void readSource() })
  srcBox?.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void readSource() })
  el('srccancel')?.addEventListener('click', () => { sourceDraft = null; render() })
  el('srcadd')?.addEventListener('click', async () => {
    const draft = sourceDraft
    if (!draft?.parsed) return
    if (isSteward) {
      // A person clicking a button in their own room. No tool, no approval,
      // and the log says a human did it.
      const added = addSourceAsHuman(store, draft.parsed, person.id)
      if (added) {
        store.dispatch({ k: 'event', event: {
          at: Date.now(), actor: person.id, kind: 'human', tool: 'add_tool_source', tier: 'share',
          summary: `added ${added.tools.length} tools from ${added.name}`,
        } })
      }
    } else {
      // A member asks. This goes through the commit tier like everything else.
      const handle = await host.handle('add_tool_source')
      const mc = resolveModelContext()
      if (mc && handle) await mc.executeTool(handle, JSON.stringify({ url: draft.url }))
    }
    sourceDraft = null
    render()
  })
  for (const b of Array.from(document.querySelectorAll('[data-drop]')) as HTMLElement[]) {
    // Two clicks rather than a confirm dialog, same as the header buttons.
    let until = 0
    b.addEventListener('click', () => {
      const id = b.dataset['drop']
      if (!id) return
      if (Date.now() > until) {
        until = Date.now() + 4000
        b.textContent = 'Really remove?'
        setTimeout(() => { if (Date.now() > until) b.textContent = 'Remove' }, 4200)
        return
      }
      removeSource(store, id)
      store.dispatch({ k: 'event', event: {
        at: Date.now(), actor: person.id, kind: 'human', tool: 'remove_tool_source', tier: 'share',
        summary: 'removed a tool source',
      } })
      render()
    })
  }

  const cmdBox = el('cmd') as HTMLInputElement | null
  const runCmd = async (): Promise<void> => {
    const command = cmdBox?.value.trim()
    if (!command || ttyBusy) return
    ttyBusy = true
    tty.push({ cmd: command, out: '' })
    if (tty.length > 12) tty.shift()
    render()
    const entry = tty[tty.length - 1]!
    try {
      const mc = resolveModelContext()
      const handle = await host.handle('computer_run')
      if (!mc || !handle) throw new Error('computer_run is not registered in this room')
      const raw = await mc.executeTool(handle, JSON.stringify({ command }))
      let text = String(raw)
      try {
        const env = JSON.parse(text) as { content?: { type: string; text?: string }[] }
        if (Array.isArray(env.content)) text = env.content.map(c => c.text ?? '').join('\n')
      } catch { /* a plain string is fine too */ }
      entry.out = text
    } catch (err) {
      entry.out = `Could not run that: ${String((err as Error)?.message ?? err)}`
    }
    ttyBusy = false
    render()
    el('cmd')?.focus()
  }
  el('runcmd')?.addEventListener('click', () => { void runCmd() })
  cmdBox?.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void runCmd() })

  el('wipe')?.addEventListener('click', async () => {
    await destroyComputer(store, scratchFor(roomKey, person.id))
    clearPrivate(roomKey, person.id)
    render()
  })

  // Two clicks, four seconds apart at most, instead of a confirm() dialog.
  const armed = (id: string, label: string, go: () => Promise<void>) => {
    const b = el(id) as HTMLButtonElement | null
    if (!b) return
    let until = 0
    b.addEventListener('click', async () => {
      if (Date.now() > until) { until = Date.now() + 4000; b.textContent = `Really ${label}?`; setTimeout(() => { if (Date.now() > until) b.textContent = label }, 4200); return }
      b.disabled = true; b.textContent = 'Working'
      await go()
      b.disabled = false; b.textContent = label
    })
  }
  armed('rotate', 'Rotate invite', async () => {
    const next = await rotateInvite(roomId, secret)
    invite = next ? roomLink(roomId, next) : null
    chat.push({ k: 'note', text: next ? 'Invite link rotated. The old member link no longer opens this room. Copy the new one to hand out.' : 'The room refused that.' })
    render()
  })
  armed('delete', 'Delete room', async () => {
    if (await deleteRoom(roomId, secret)) { forgetRoom(roomId); location.href = '/' }
    else { chat.push({ k: 'note', text: 'The room refused that.' }); render() }
  })

  el('switch')?.addEventListener('change', e => {
    const v = (e.target as HTMLSelectElement).value
    if (v === '__new') { location.href = '/'; return }
    switchRoom(v)
  })

  for (const b of Array.from(mount.querySelectorAll<HTMLElement>('[data-ok],[data-no]'))) {
    b.addEventListener('click', () => {
      const id = b.dataset['ok'] ?? b.dataset['no']
      const approval = store.state.approvals.find(a => a.id === id)
      if (approval) void settleApproval({ store, def, approval, by: person, ok: Boolean(b.dataset['ok']) })
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

/**
 * The day's free model allowance is spent, so the room walks a fixed sequence
 * instead of an argued one. Every call below is real and goes through
 * executeTool, so the log, the sync and the parked approval are all genuine.
 * Only the choice of calls is scripted, and the note says so before the first
 * one runs.
 */
async function runRehearsal(): Promise<void> {
  const mc = resolveModelContext()
  const plan = rehearsedPlan(def.id)
  if (!mc || isSteward || !plan.length) return

  chat.push({ k: 'note', text: REHEARSAL_NOTE })
  thinking = true
  render()

  for (const step of plan) {
    const handle = await host.handle(step.name)
    if (!handle) continue
    try {
      await mc.executeTool(handle, JSON.stringify(step.args))
    } catch {
      // A rehearsal is best effort. A step that will not run is not worth
      // stopping the rest of the sequence over.
    }
    render()
    // Paced so a person can read it. Instant is not a demonstration.
    await new Promise(r => setTimeout(r, 700))
  }

  thinking = false
  render()
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
  store.subscribe(() => { void watchSources() })

  link = connectRoom({
    roomId,
    secret,
    since: () => store.lastSeq(),
    onEnvelope: env => store.receive(env),
    who: { id: person.id, name: person.name },
    onWaiting: () => {
      // Take the tools down as well as the page. A person waiting outside has
      // no business holding a registered surface, and their agent should see
      // an empty room rather than tools that will be refused.
      waitingOutside = true
      void host.unmount().then(() => { surface = []; render() })
      render()
    },
    onKnock: (list, mode) => {
      knocking = list
      if (mode) door = mode
      render()
    },
    onWelcome: async w => {
      const wasOutside = waitingOutside
      waitingOutside = false
      if (w.door) door = w.door
      if (w.waiting) knocking = w.waiting
      // The page has to mount something before the server has spoken, so it
      // assumes the least: member, and whatever the URL hinted at. Both can
      // turn out wrong, and a wrong def means a support desk holding a
      // marketing team's tools, so remount whenever either actually changed.
      const roleChanged = (w.role === 'steward') !== isSteward
      const defChanged = Boolean(w.defId) && w.defId !== def.id
      isSteward = w.role === 'steward'
      if (defChanged) {
        def = roomById(w.defId)
        store = createStore({ def, roomKey, me: person, role: w.role })
        store.subscribe(render)
        store.subscribe(() => { void watchSources() })
        sourcePrint = ''
        store.setSink(env => link?.send(env))
      }
      // History goes into whichever store survived the line above. It used to
      // be applied before this handler ran, which meant every late joiner to a
      // room that was not the default kind got an empty board: the items had
      // been replayed into a store that was then replaced. Three of the four
      // rooms were unusable for anyone but the first person in, and it looked
      // like a sync problem rather than what it was.
      for (const env of w.ops) store.receive(env)
      if (roleChanged || defChanged || wasOutside || !surface.length) {
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
          if (reason === 'error') {
            chat.push({ k: 'note', text: detail ?? 'The agent could not be reached.' })
            render()
            // Out of Neurons rather than broken. Show the loop anyway.
            if (detail && /allowance|quota|neuron/i.test(detail)) { void runRehearsal(); return }
          }
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
