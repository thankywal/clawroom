// The front door. Pick a workplace, get a link, send the link to people.

import { roomList } from '../rooms/index.js'
import { me, setName } from '../engine/identity.js'

const slug = () => {
  const words = ['amber', 'quiet', 'north', 'ember', 'slate', 'linen', 'harbor', 'violet']
  const pick = () => words[Math.floor(Math.random() * words.length)] ?? 'room'
  return `${pick()}-${pick()}-${Math.random().toString(36).slice(2, 5)}`
}

const link = (defId: string, instance: string, as?: 'steward') =>
  `/room.html?room=${defId}&r=${instance}${as ? '&as=steward' : ''}`

function render(): void {
  const mount = document.getElementById('lobby')
  if (!mount) return
  const person = me()

  mount.innerHTML = `
    <p class="lede">Each person opens the room with their own agent. Every tool call the
      agents make lands in a shared log, like a commit. Whoever is responsible reads the
      log, never the conversations, and nothing ships without a human.</p>

    <div class="youare">
      You are <input id="name" value="${person.name}" size="10" aria-label="Your name">
      <span class="dim">stored in this browser, no account</span>
    </div>

    <div class="rooms">
      ${roomList().map(r => {
        const inst = slug()
        return `<article class="roomcard">
          <h3>${r.title}</h3>
          <p>${r.premise}</p>
          <p class="dim">${r.memberRole} and ${r.stewardRole}, ${r.memberTools.length} tools</p>
          <div class="btns">
            <a class="btn primary" href="${link(r.id, inst)}">Open as ${r.memberRole}</a>
            <a class="btn ghost" href="${link(r.id, inst, 'steward')}">Open as ${r.stewardRole}</a>
          </div>
        </article>`
      }).join('')}
    </div>

    <p class="foot">
      <a href="/selftest.html">Tool self-test</a>, every tool called with no agent.
      <a href="/smoke.html">WebMCP probe</a>, what the browser underneath actually implements.
    </p>`

  const input = document.getElementById('name') as HTMLInputElement | null
  input?.addEventListener('change', () => { setName(input.value); render() })
}

render()
