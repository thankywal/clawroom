**Live, one click, no signup and no flags:** https://clawroom.thankywal-bkk.workers.dev

**Film (2:53):** https://youtu.be/c9gOER5Djeo

ClawRoom is git for agent work. A shared room where everyone brings their own AI agent, every agent gets a Linux computer of its own, every tool call lands in a log the whole room reads like a commit, and nothing irreversible ships until a person approves it.

Press **Open the demo room**. Two windows open: you as Cara, the manager, and Ella, one of your team. Ella's agent has already drafted twice, run a script on its own machine, and asked to publish. That request is sitting in your window with the actual words in it, waiting for you.

## The smaller case, which is the one that is true today

A room is for a team, and a team where everybody brings an agent is a near future rather than a present one. The version that is true on an ordinary Tuesday is smaller: **one person running more than one agent at once.** Anybody with Claude Code and Codex both installed already does it, and already has the problem: two terminals, two histories, no shared record, and the only thing stopping either of them from doing something irreversible is that you happen to be watching.

Same product, not a different mode. Each agent gets a seat with its own name, its own computer, and one log you read.

Both bridges started within a second of each other against one room, and this is what a third window, which neither agent could write to, recorded:

```
Claude  local   list_posts       read the board, 3 posts
Codex   local   list_posts       read the board, 3 posts
Claude  commit  publish          asked to publish "Launch announcement" to blog
Codex   commit  publish          asked to publish "Launch announcement" to blog
Claude  local   check_approval   checked apv_ir7e
Codex   local   check_approval   checked apv_d6hq
```

The lines interleave because both were working in the same second, and the names are still right, because the server stamps the sender from the socket rather than believing the envelope. Two agents asked to publish the same item and got two separate handles. Neither shipped. Two decisions were waiting on a person at the end of it, which is the point of the smaller case: you can leave two agents running and come back to a queue of decisions rather than a pile of published work you did not ask for.

`--away "<task>"` is the same thing on a machine you are not watching. An agent can work all night. It cannot ship anything all night.

## Why WebMCP, and not a server

Because the tools have to live in the page.

Each person's agent runs in their own browser with their own private context. A server-side MCP integration funnels everyone's drafts through one process, which is the exact arrangement this is trying to avoid. WebMCP puts the tool surface inside the document, so the private half of somebody's work never has to leave their machine to take part in shared work. Remove WebMCP and this is not a worse version of itself, it is a different product.

The surface is also live, and that turns out to be the best thing in here. Registration is per tool under its own `AbortController`, because the API has no `unregisterTool()`. So when a person approves a new tool source, four tools appear in everyone's browser at once and nothing else moves: measured going 21 to 25 with no dip, where a whole-surface rebuild used to drop to zero in between. That is a self test case now, and it asserts the delta rather than the total: four named tools added, none lost, read back out of `getTools()`. `ontoolchange` is what tells a long-lived client, and the MCP bridge listens on it.

## Three tiers, and the tier is not a permission level

It is a statement about where the payload lives.

- **work** stays in the member's browser. The room gets one line: *"drafted variant 3 of the launch announcement"*. Never the variant.
- **share** puts something on the board. That is the moment a thing stops being yours.
- **commit** does nothing at all until a person approves.

Enforcement is by construction, not by asking nicely: the engine wraps every tool before registering it, and hands the unapproved pass of a commit-tier tool a `put()` that throws. A room author cannot forget the rule.

Commit-tier calls do not block the agent. The call returns a receipt with a handle, the approval becomes an object in shared state, and the agent carries on or polls. The API as shipped has no user-confirmation mechanism (measured: `ModelContext` exposes only `registerTool`, `getTools`, `executeTool` and `ontoolchange`), and holding the execute promise open for minutes would time out and occupy the page's surface while it waited. That is our proposal for the gap, and it went to the spec group.

No agent can approve, and the person approving reads the thing itself: the card carries the headline, the words, and the arguments. "The room sees the work, not the people" is about never capturing somebody's conversation. It was never about hiding the artefact from the person asked to ship it. An approver who cannot read what they are approving is a rubber stamp, which is the failure this design exists to avoid.

## A computer for every agent

The moment a member's agent walks into a room it gets a Linux sandbox: a shell, `/workspace`, Python and Node, one per person per room, asleep when idle. Built on Cloudflare Sandbox.

The point is not that agents can run code. It is where the code runs and who gets to see:

```
Ella   local   computer_run          ran `python3 analyse.py` (exit 0, 14 lines out)
Ella   local   computer_write_file   wrote report.md (2311 bytes)
Ella   shared  computer_share_file   shared report.md to the board (2311 characters)
```

The first two lines are what the manager sees. The third is the agent choosing, through a tool whose description says exactly that, to make one file public.

It is a real machine: `computer_serve` keeps a server running, `computer_share_page` puts what it shows on the board, `computer_browse` reads a public page through Browser Rendering, `computer_snapshot` and `computer_restore` keep the workspace. And the person has a console into the same machine through the same `computer_run` tool, so a person and their agent share one computer and one log. The manager gets counts per member, never contents, and a signal when somebody has failed three commands in a row.

## Tools the room borrowed

Point a room at an OpenAPI document or a remote MCP server and its operations become tools for everyone, tiered by the same rules. Reads are work, writes are share, and anything that sounds irreversible is commit and waits for a person.

What makes it safe to offer is that **`add_tool_source` is itself commit tier**. An agent can propose a source and nothing registers. A person approves, and in that instant every browser in the room has the tools. Two URLs that work today:

```
https://clawroom.thankywal-bkk.workers.dev/api/demo/openapi.json   a fixture with a refund in it
https://mcp.deepwiki.com/mcp                                       a real MCP server, no key
```

Point it at an ordinary page that registers its own WebMCP tools and the room says it found them and cannot call them. A tool surface belongs to a document, and `getTools({ fromOrigins })` is not implemented. Saying so beats pretending.

## Bring your own agent, or your own model

```
claude mcp add clawroom -- node scripts/clawroom-mcp.mjs "<member link>"
codex  mcp add clawroom -- node scripts/clawroom-mcp.mjs "<member link>"
```

The bridge holds no tools. It opens the room in a real Chrome and passes `getTools()` and `executeTool()` through, so the tier engine stays in the one place it can be enforced. Both commands are printed for you inside any room, under **Your agent**, with that room's link already in them.

**Claude Code and Codex have both driven a room through it, three runs between them.** Given the bridge and a link and nothing else, each read the board, drafted privately, submitted one, asked to publish, was parked, and reported that nothing had shipped without retrying.

Claude Code then did something the design hoped for and could not have scripted: it flagged that its own submitted copy was full of `[PLACEHOLDER]`s, because the brief carried no real prices and it would not invent them, and said the pending publish *should be declined rather than approved*.

The most interesting run is the third, because it was not driven by a script. A person added the bridge to their own Codex CLI, typed one sentence, and approved each tool as Codex asked. After being parked, Codex called `list_posts` again and read the board itself rather than believing the tool's answer or its own summary, and found the item still in review. A client verifying a claim about state is exactly what a shared log is for.

All three transcripts are in `docs/evidence/`, next to what the room recorded independently for each, along with the run where both bridges were pointed at one room at the same time.

`--away "<task>"` runs the same thing on a machine you are not watching. An agent can work all night; it cannot ship anything all night. You wake to a queue of decisions.

Under the composer, `use your own` points the in-page agent at any OpenAI-compatible endpoint. The key stays in your browser and is forwarded once per request; nothing stores it.

## Proving it rather than claiming it

"Commit-tier calls wait for a human" is easy to write and easy to believe, because a cooperative model parks the call whether or not anything makes it. So I ablated the engine: same room, same model, same prompt, same tool description telling the model publishing waits for a person. In one arm the engine enforces it; in the other only the description asks. Eight trials per arm, every transcript committed:

| arm | called `publish` | published with no human approval |
|---|---|---|
| tier engine | **8 / 8** | **0 / 8** |
| description only | **8 / 8** | **8 / 8** |

The first column is the finding, and it took a correction to state properly. **The model behaved identically in both arms.** It called the commit-tier tool every time after being told plainly not to. The description changed nothing about what the model did; the engine changed what happened. An earlier version of this writeup implied the unguarded model *chose* the shortcut, and quoted a line that is in no committed file. That was wrong, it is corrected here rather than quietly dropped, and the JSON is in the repo. Thirteen committed trials per arm, one model, one prompt: enough to settle whether the designs differ, not enough to put a rate on models in general, and I claim none.

`/selftest.html` calls every tool through `executeTool()` with no agent and passes **23 of 23** against the deployed origin in a clean Chrome, no flags. Ten of those test the claim rather than a function: a sentinel sentence written into a private draft and then hunted through all of shared state; a publish that must leave the board unmoved until a human clicks; a canary in a file on the sandbox; a page served on a port that must not reach the board until `computer_share_page`; a snapshot that survives `rm -rf`; a borrowed refund that parks and only then takes effect; and the live surface itself, asserted as a delta rather than a total, going 21 to 25 with four named tools added and none lost.

Both pages ship with the site. Run them yourself.

## What the audit found

Three people audited this against the deadline. The worst thing they found is fixed rather than described.

The Durable Object used to authorise only `settle`, so a member on a raw socket could post an item marked done, or a log line with `kind: 'human'` and somebody else's name on it. The manager's log is the product, and a log the watched party can write is not a log. The server now stamps the sender from the socket and refuses any op claiming to be somebody else; sources are the steward's alone. Four forgeries refused, the honest op accepted and stamped. The agent endpoint no longer forwards to arbitrary addresses, the tool proxy checks every redirect hop, and a room hands out at most twelve computers.

## What I found out about the ecosystem

Chrome's Gemini side panel does not call WebMCP tools. Given a room and a task it ran a Google search and reported constraints it had stored and options it had proposed, none of which had happened. That left a mark on the design: tool chips render from engine events, never from what a model claims, so a model narrating a publish it never called leaves a visibly empty log.

Four measurements are in `docs/WEBMCP-NOTES.md`, and each cost time:

- `getTools()` returns `inputSchema` as a stringified `DOMString`, and `executeTool()` still takes a JSON string, both lagging the spec's move to objects.
- Chrome 151 keeps `readOnlyHint` and `untrustedContentHint` and **silently drops `destructiveHint`, `idempotentHint` and `openWorldHint`**. For an app about irreversible actions that is the one that matters: a page has no way to tell a model, through the API, that a tool is destructive.
- `getTools({ fromOrigins })` does not throw. It discards the filter and returns local tools, so a caller gets a plausible wrong answer instead of an error.
- **Cloudflare Browser Rendering is HeadlessChrome/128**, and WebMCP arrived in 151. A WebMCP page is not automatable by the headless browsers that sites already have. `/api/cloudprobe` measures it and stays in the repo, because it will answer yes one day with no edit.

One of these is here because I got it wrong first: my notes said `getTools()` returned no schema at all, I wrote that in an earlier version of this description, and re-measuring is what found the truth. `docs/LIMITS.md` keeps the correction rather than deleting it.

## What is still weak

`docs/LIMITS.md` says this at length. The short version: the privacy boundary is per browser rather than cryptographic, so I defend the room from the room and not the browser from itself. The computer is on Cloudflare, not the member's laptop, so the operator could read what the room cannot. Capability links are bearer secrets; the steward can rotate one, but a leaked link works until they do. The door that makes a steward admit each arrival is a social gate, not an identity system. A borrowed tool's description is written by whoever runs that API, so every borrowed tool is marked untrusted. Bringing your own model puts your key in a browser and passes it through my Worker, which stores nothing, but that is a claim about code you can read. The hosted model is a small free one and it loops on an open question if nothing stops it, so the room refuses a repeat of a call it already made this turn, which is a workaround for one model rather than a fix for anything. And no shipping agent product speaks WebMCP yet, so the third-party client that drove a room reached it through my adapter.

## Taking it back to the spec

[webmcp#165](https://github.com/webmachinelearning/webmcp/issues/165) is the open discussion on human-in-the-loop. [My comment there](https://github.com/webmachinelearning/webmcp/issues/165#issuecomment-5462267165) argues that elicitation and authorization have different latency and want different shapes: elicitation is the person in front of you supplying one missing input in seconds, and a blocking call is right for it, while authorization is a *different* person consenting on their own schedule, where holding `execute()` open is not a slow promise but an abandoned one. It carries the ablation numbers, because the argument that matters to a spec is that a guarantee written in prose the model reads is not a guarantee.

## What is next

The approval mechanic wants to be a proposal rather than one project's convention: a tier declared on the tool, a resolution that returns a handle instead of blocking, and a standard way to ask whether it has settled. And rooms want to federate properly, which needs the thing the spec already names: `getTools({ fromOrigins })`, so a room could reach the tools a partner site registers in its own page rather than only the ones behind an HTTP description.

---

**Also worth a click:** [`/ablate.html`](https://clawroom.thankywal-bkk.workers.dev/ablate.html) removes the enforcement engine and measures what happens. [`/selftest.html`](https://clawroom.thankywal-bkk.workers.dev/selftest.html) calls every tool with no agent at all. In a room, paste the demo OpenAPI URL into Borrowed tools and watch an API become tools everyone gets at once.

TypeScript throughout, strict, no framework. Vite builds five pages. Cloudflare Workers serves them, hosts a stateless LLM proxy, and runs one Durable Object per room on the SQLite backend, one Sandbox container per member per room, and Browser Rendering for the browse tool. Five rooms ship from one engine, one of them generated from an OpenAPI file by `npm run generate`.
