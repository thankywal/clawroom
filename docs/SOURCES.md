# Borrowed tools

A room ships with its own tools, written in TypeScript. A **source** is the
other way in: point the room at an OpenAPI document or a remote MCP server and
its operations become tools for everyone in that room.

    npm run generate -- api.json     writes a room file, at build time
    add_tool_source                  borrows one, at run time, after a person says yes

The first is for the person building a room. This document is about the second.

## The rule that makes it safe to offer

`add_tool_source` is itself a **commit-tier tool**. An agent can propose a
source and nothing at all registers. The call parks, a person in the room
approves, and only then do the tools exist.

That is not a policy written in a description. It is the same tier engine that
holds `publish`: the unapproved pass of a commit-tier tool is handed a `put()`
that throws, so the tool physically cannot change shared state before a human
clicks. The ablation in [EVIDENCE.md](EVIDENCE.md) is the measurement of what
that is worth, and it applies here unchanged.

The steward can also add a source by hand, from the Borrowed tools panel. That
is not a hole: a person clicking a button in their own room is a person, and
the work log says `person` rather than `agent` on that line.

## The moment worth watching

When the approval lands, the `source` op reaches every browser in the room.
Every browser remounts its tool surface. So `document.modelContext` changes for
four people at the same instant, and an agent that asked about the tools a
minute ago now has them, with nobody reloading anything.

This is the part that belongs in a WebMCP project rather than in a plugin
system. The API's surface is meant to be live: there is an `ontoolchange` event
for exactly this, and no `unregisterTool()`, so taking the old surface down runs
through the `AbortController` every tool was registered under.

## Tiers, decided at import

Every borrowed operation gets a tier from its verb and its name.

| what it looks like | tier | what happens |
|---|---|---|
| `GET`, `HEAD`, or an MCP tool named `read_`/`get_`/`list_`/`search_`/`ask_` | work | the result goes to the agent that asked, the room learns a call happened |
| any other write | share | the result lands on the board |
| `DELETE`, or a name or summary containing publish, send, pay, charge, refund, cancel, ship, deploy, release, transfer, destroy | commit | it parks for a person, every time |

Two overrides. `x-clawroom-tier` on an OpenAPI operation says it outright. An
MCP tool's `readOnlyHint` and `destructiveHint` annotations are honoured when
the server sets them, which most do not, hence the name check.

Borrowed tool names are prefixed with the source, so the log says where a call
went: `harbour_foods_order_refund_order`. It also means a source cannot quietly
shadow one of the room's own tools.

## Why the Worker is in the middle

Two reasons, and neither is a preference.

A browser cannot fetch a description from another origin. CORS decides that,
not us.

And the browser should not be the thing that decides which hosts are safe to
call. The Worker refuses loopback, link local, the private ranges and the cloud
metadata address before it fetches anything. That check is a hostname and
literal check, not a resolved address check, so a hostname that resolves to a
private address on purpose gets through. [LIMITS.md](LIMITS.md) says so.

What the Worker is not is a registry. It stores nothing. The parsed source goes
back to the browser, lands in the room's shared state when a person approves it,
and is handed back to the Worker on every call.

## Try it

The site serves a fixture so the feature has a URL that works on the first try:

    https://clawroom.thankywal-bkk.workers.dev/api/demo/openapi.json

Four operations: two reads, a note, and a refund. Paste it into the Borrowed
tools panel. The refund arrives as commit tier, and a member's agent asking for
one waits for the manager, the same way `publish` does.

For a real third-party MCP server, DeepWiki's is public and needs no key:

    https://mcp.deepwiki.com/mcp

It brings three tools, all classified as reads, and they work: asking it for
the structure of `cloudflare/workers-sdk` returns the page list.

## A page that registers its own WebMCP tools

If you point a source at an ordinary web page that registers WebMCP tools, the
room will tell you it found them and that it cannot call them.

That is not a limitation we could engineer around. A tool surface belongs to a
document. `document.modelContext` in one page is not reachable from another
origin's page, and `getTools({ fromOrigins })` is in the spec but not in Chrome
151. An agent that wants those tools has to be on that page.

The honest answer is the one the room gives: the source is recorded as a link,
with a note saying why it brought no tools. Pretending otherwise would be the
one kind of demo this project is trying not to be.
