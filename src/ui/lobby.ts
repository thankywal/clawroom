// The front door. Make a room, put your own work in it, send the link.
//
// There is no account. A room hands out two links when it is created, and the
// secret in the link is the credential: the steward link can approve things,
// the member link cannot, and the server enforces that rather than the page.
// The rooms you hold links to are remembered in this browser, which means
// losing the browser loses the list unless you kept a link. That is the
// tradeoff for there being no central record of who belongs to what.

import { roomList } from '../rooms/index.js'
import { me, setName } from '../engine/identity.js'
import { createRoom, forgetRoom, roomLink, roomMeta, savedRooms } from '../engine/rooms-local.js'
import type { WorkItem } from '../types.js'

const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const el = (id: string) => document.getElementById(id)

/** The template's own seed, shown as a starting point rather than imposed. */
function suggested(defId: string): string {
  const def = roomList().find(r => r.id === defId)
  if (!def) return ''
  return def.seed([me()]).map(i => {
    const brief = (i.body as Record<string, unknown>)['brief'] ?? (i.body as Record<string, unknown>)['question']
      ?? (i.body as Record<string, unknown>)['problem'] ?? (i.body as Record<string, unknown>)['want'] ?? ''
    return brief ? `${i.title}: ${brief}` : i.title
  }).join('\n')
}

function itemsFrom(text: string): WorkItem[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 20).map((line, n) => {
    const at = line.indexOf(':')
    const title = at > 0 ? line.slice(0, at).trim() : line
    const brief = at > 0 ? line.slice(at + 1).trim() : ''
    return {
      id: `w_${n + 1}`,
      title,
      state: 'open' as const,
      body: { brief, question: brief, problem: brief, want: brief, channel: 'the board', headline: '', submitted: '', reply: '', picked: '', customer: '', answer: '' },
    }
  })
}

function render(): void {
  const mount = el('lobby')
  if (!mount) return
  const person = me()
  const mine = savedRooms()
  const chosen = (el('kind') as HTMLSelectElement | null)?.value ?? roomList()[0]?.id ?? 'campaign'

  mount.innerHTML = `
    <p class="lede">Each person opens the room with their own agent. Every tool call the
      agents make lands in a shared log, like a commit. Whoever is responsible reads the
      log, never the conversations, and nothing ships without a human.</p>

    <div class="youare">
      You are <input id="name" value="${esc(person.name)}" size="10" aria-label="Your name">
      <span class="dim">stored in this browser. Rooms are opened with a link, not an account.</span>
    </div>

    ${mine.length ? `
      <section class="zone" style="margin-bottom:18px">
        <div class="zhead"><h2>Your rooms</h2><span class="note">links you hold</span></div>
        <div class="zbody">
          ${mine.map(r => `<div class="mine">
            <a href="${roomLink(r.roomId, r.secret)}">${esc(r.title)}</a>
            <span class="meta">${esc(r.role)}</span>
            <button class="ghost small" data-drop="${r.roomId}">Forget</button>
          </div>`).join('')}
        </div>
      </section>` : ''}

    <section class="zone demo" style="margin-bottom:18px">
      <div class="zhead"><h2>See it running</h2><span class="note">nothing to fill in</span></div>
      <div class="zbody">
        <p class="demoline">Opens a marketing room with work already on the board. You land
          as the manager, and a second window opens as Ella, one of your team, so both halves
          of the room are in front of you. Ask Ella's agent to draft and submit something,
          then watch your log fill and an approval arrive. Ella's agent has a computer of its
          own in the room, a real Linux machine, so ask it to write and run a script as well.
          You will see that it ran. You will not see what it ran.</p>
        <div class="btns">
          <button class="primary" id="demo">Open the demo room</button>
          <span id="derr" class="empty"></span>
        </div>
      </div>
    </section>

    <section class="zone">
      <div class="zhead"><h2>Start a room</h2><span class="note">you get two links</span></div>
      <div class="zbody make">
        <label>What is it called
          <input id="title" placeholder="Q3 launch, Tuesday worksheet, Friday tickets">
        </label>
        <label>What kind of room
          <select id="kind">
            ${roomList().map(r => `<option value="${r.id}" ${r.id === chosen ? 'selected' : ''}>${esc(r.premise)}</option>`).join('')}
          </select>
        </label>
        <label>What is on the board
          <textarea id="items" rows="5" placeholder="One per line. Put a colon after the name for a brief."></textarea>
          <span class="empty">Pre-filled from the template. Replace it with your actual work.</span>
        </label>
        <div class="btns">
          <button class="primary" id="make">Create the room</button>
          <span id="err" class="empty"></span>
        </div>
      </div>
    </section>

    <p class="foot">
      <a href="/selftest.html">Tool self-test</a>, every tool called with no agent.
      <a href="/ablate.html">Tier ablation</a>, what happens when the engine is removed.
      <a href="/smoke.html">WebMCP probe</a>, what the browser underneath actually implements.
    </p>`

  const nameInput = el('name') as HTMLInputElement | null
  nameInput?.addEventListener('change', () => { setName(nameInput.value); render() })

  const kind = el('kind') as HTMLSelectElement | null
  const items = el('items') as HTMLTextAreaElement | null
  const title = el('title') as HTMLInputElement | null
  if (items && !items.value) items.value = suggested(chosen)
  kind?.addEventListener('change', () => { if (items) items.value = suggested(kind.value) })

  for (const b of Array.from(mount.querySelectorAll<HTMLElement>('[data-drop]'))) {
    b.addEventListener('click', () => { forgetRoom(b.dataset['drop'] ?? ''); render() })
  }

  el('demo')?.addEventListener('click', async () => {
    const button = el('demo') as HTMLButtonElement | null
    const err = el('derr')
    // Opened inside the gesture and pointed somewhere later, because a
    // window.open that happens after an await is a popup blocker's definition
    // of a popup.
    const second = window.open('about:blank', '_blank')
    if (button) { button.disabled = true; button.textContent = 'Opening' }
    try {
      const room = await createRoom({ defId: 'campaign', title: 'Q3 launch campaign' })
      localStorage.setItem(
        `clawroom:pending:${room.roomId}`,
        JSON.stringify(itemsFrom(suggested('campaign'))),
      )
      const meta = await roomMeta(room.roomId, room.secret)
      if (second) {
        if (meta?.invite) second.location.href = `${roomLink(room.roomId, meta.invite)}&as=Ella`
        else second.close()
      }
      location.href = roomLink(room.roomId, room.secret)
    } catch (e) {
      second?.close()
      if (err) err.textContent = String((e as Error)?.message ?? e)
      if (button) { button.disabled = false; button.textContent = 'Open the demo room' }
    }
  })

  el('make')?.addEventListener('click', async () => {
    const button = el('make') as HTMLButtonElement | null
    const err = el('err')
    const name = title?.value.trim()
    if (!name) { if (err) err.textContent = 'Give the room a name first.'; title?.focus(); return }
    if (button) { button.disabled = true; button.textContent = 'Creating' }
    try {
      const room = await createRoom({ defId: kind?.value ?? chosen, title: name })
      // The creator's items travel in this browser and are written into the
      // room on first connect, so the server never has to know what work is.
      localStorage.setItem(`clawroom:pending:${room.roomId}`, JSON.stringify(itemsFrom(items?.value ?? '')))
      location.href = roomLink(room.roomId, room.secret)
    } catch (e) {
      if (err) err.textContent = String((e as Error)?.message ?? e)
      if (button) { button.disabled = false; button.textContent = 'Create the room' }
    }
  })
}

render()
