#!/usr/bin/env node
// Makes a room and prints the two links, plus the exact commands to point a
// coding agent at it.
//
//   npm run room
//   npm run room -- --kind support --title "Friday tickets"
//
// A room has two keys and they are not interchangeable. The steward link is
// the person who approves; the member link is the person who works, and it is
// the one an agent should be given. Handing an agent the steward link is the
// commonest way to end up staring at five read-only tools and wondering where
// the product went.

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const BASE = opt('base', process.env['CLAWROOM_BASE'] ?? 'https://clawroom.thankywal-bkk.workers.dev')
const defId = opt('kind', 'campaign')
const title = opt('title', 'Q3 launch campaign')
const name = opt('as', 'Codex')

const res = await fetch(`${BASE}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ defId, title }),
})
if (!res.ok) {
  console.error(`could not make a room: ${res.status} ${await res.text()}`)
  process.exit(1)
}
const room = await res.json()
const link = key => `${BASE}/room.html?r=${room.roomId}&k=${key}`
const bridge = `${process.cwd()}/scripts/clawroom-mcp.mjs`

console.log(`
Room "${title}" (${defId}) is up.

  You, the person who approves:
    ${link(room.steward)}

  Your agent, the one that does the work:
    ${link(room.member)}&as=${name}

Open the first one in Chrome and leave it there. That window is where the log
fills and where the Approve button is. Then point an agent at the second:

  claude mcp add clawroom -- node ${bridge} "${link(room.member)}&as=${name}"

  codex mcp add clawroom -- node ${bridge} "${link(room.member)}&as=${name}"

Then ask it: "read the board, draft two options for the launch announcement,
submit the better one, and ask to publish it."

Codex note: in the interactive CLI it will ask you to allow each tool, which is
the normal path. Non-interactively, codex exec defaults to an approval policy
of never and refuses MCP calls outright, so that needs --approve-for-me.

The bridge starts its own headless Chrome. Set CLAWROOM_HEADFUL=1 if you would
rather watch it work. When you are done: claude mcp remove clawroom, or
codex mcp remove clawroom.
`)
