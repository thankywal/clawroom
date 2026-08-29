# Devpost submission text

Paste ready. The rules ask for four things: why WebMCP suits this use case, how
it improves the experience, what humans and agents can now do together, and the
implementation approach.

---

## Inspiration

Everyone is about to have an agent doing part of their job, and the person
responsible for a team is about to lose sight of the work entirely. The current
answers are both bad. Ban it, which does not work. Or install something that
watches people, which they will resent and route around.

Git solved a version of this thirty years ago. A commit log shows what changed
without showing how long you sat there. A pull request is a place to say yes
without being a surveillance record.

ClawRoom is that shape, for agent work.

## What it does

A shared room where each person brings their own AI agent. Every tool call an
agent makes lands in a visible log, like a commit. The person in charge reads
the log and never the conversations. Anything irreversible waits for a human.

Four rooms ship, from one engine: a marketing department, a classroom, a
support desk and a shop floor. Switch between them live and the tool surface
visibly changes, because a room is a definition object rather than an app.

The support desk carries the clearest argument. When the same diagnostic fails
across four different tickets, that is one product bug and not four support
conversations. Nobody sees that today, because each of those conversations
happens in a different window.

## Why WebMCP suits this

Because the tools have to live in the page, not on a server.

Each participant's agent runs in their own browser, in their own session, with
their own private context. A server-side MCP integration would funnel every
member's drafts and constraints through one process, which is exactly the
arrangement this is trying to avoid. WebMCP puts the tool surface inside the
document, so the private half of someone's work never has to leave their
machine in order to take part in shared work.

The surface is also live rather than fixed. Switching rooms changes what the
agents in the room can do, and since the API has no unregisterTool that turns
entirely on the AbortController the tools were registered under.

## How it improves the experience

Three tiers, and the tier is not a permission level, it is a statement about
where the payload lives.

Work-tier calls stay in the member's browser. Drafting, running a diagnostic,
asking for a hint. The room gets one summary line: "drafted variant 3 of the
launch announcement". Not the variant.

Share-tier calls put something on the board. That is the moment a thing stops
being yours.

Commit-tier calls do nothing at all until a person approves. Crucially they do
not block the agent either. The call returns a receipt with a handle, the
approval becomes an object in shared state, and the agent can poll the handle
or carry on with other work. WebMCP has no user-confirmation mechanism and
holding the execute promise open until someone clicks would time out and
occupy the page's tool surface while it waited. So this is our proposal for the
gap, and it is the piece most likely to be useful outside this project.

No agent can approve. The steward's agent can read the queue and argue for
something, but only a person clicks. An agent that could approve its own room's
commits would make the whole tier decoration.

## What humans and agents can now do together

A marketer's agent reads the board, writes three variants privately, submits
one, and asks to publish. The manager sees that three were written and one was
submitted, approves the publish, and never reads the two that were discarded.
Neither half of that works alone. Without the agent the marketer writes all
three by hand. Without the human nothing ships.

The turns interleave, which is the part that took us three abandoned ideas to
understand. Collaboration is not one delegation, it is many small ones with a
judgment call between each.

## Implementation

TypeScript throughout, strict, no framework. Vite builds four pages. Cloudflare
Workers serves them, hosts a stateless LLM proxy, and runs one Durable Object
per room.

Tools are declared as data on a RoomDefinition and registered with
`document.modelContext.registerTool` under a single AbortController. The engine
wraps every tool before registration, which is how tier enforcement holds by
construction: the unapproved pass of a commit-tier tool is handed a `put` that
throws, so a room author cannot forget the rule.

The site hosts its own agent, and it matters that it does. Chrome's Gemini side
panel does not call WebMCP tools. Given a room and a task it ran a Google
search, read the page, and reported constraints it had stored and options it had
proposed, none of which had happened. ChatGPT's site tools want a paid Work
plan. Between them, a visitor with no subscription could not see the thing work
at all. The origin trial covers agents hosted by the site, so the site hosts
one: the tool-calling loop runs in the browser over
`document.modelContext.executeTool`, which is the difference between a WebMCP
demo and a chatbot with a switch statement behind it.

That episode left a mark on the design. Tool chips in the chat panel render from
engine events, never from what the model claims. A model that narrates a publish
it never called leaves a visibly empty log.

## Challenges

Three things cost real time and are written up in docs/WEBMCP-NOTES.md.

There is no `unregisterTool()`, so a tool surface can only be taken down by
aborting the signal it was registered under. Abort does remove tools, but
nothing says it is synchronous, so the host waits for the old names to actually
disappear before registering new ones.

`executeTool()` resolves to the result envelope as a JSON string rather than an
object, so unwrapping is two parses deep.

`getTools()` returns names and descriptions with no inputSchema, so an agent
cannot learn how to call a tool from WebMCP alone. Schemas come from the room
definition and the handle comes from getTools, each providing the half it can.

## Accomplishments

`/selftest` calls every tool through executeTool with no agent involved and
passes 10 out of 10 against the deployed origin in a clean Chrome profile with
no flags set. Two of those cases test the claim rather than a function. One
writes a sentinel sentence into a private draft and searches all of shared
state for it, because if that string ever appears the product does not do what
it says. The other calls publish, checks the board did not move, approves as a
human, and only then expects the effect.

## What's next

The approval mechanic wants to be a spec proposal rather than one project's
convention: a tier declared on the tool, a resolution that returns a handle
instead of blocking, and a standard way to ask whether the handle has settled.

Rooms want to federate. `getTools({ fromOrigins })` already exists, so a room
could reach tools a partner site exposes rather than only its own.
