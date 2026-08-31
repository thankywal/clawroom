# Limits

What ClawRoom does not do, where the boundary is softer than the pitch, and
what we did not get to. Written by the people who built it, because a judge or
a user will find these anyway and it is better that we name them first.

## The privacy boundary is per browser, not cryptographic

The claim is that a work-tier payload never reaches shared state, and that is
true and tested: `/selftest` writes a sentinel into a draft and searches every
item and event for it. What that means precisely is that ClawRoom's own engine
never puts it on the wire.

It does not mean the draft is protected from the machine it is on. Scratch
lives in `localStorage` under a `clawroom:<room>:<member>:` prefix. Any script
running on this origin can read it, which includes a browser extension with
host permissions and would include an XSS in our own page. We defend the room
from the room. We do not defend the browser from itself.

A stronger version would encrypt scratch under a key held outside the page.
We did not build that.

## The computer is on Cloudflare, not on the member's laptop

Every member's agent now gets a Linux sandbox, and the room cannot see inside
it: commands, output and files are work tier, the log gets counts and exit
codes, and a sandbox is addressed by a secret that lives only in the browser
that minted it. Another member holding the same room key cannot reach it.

What that boundary is not is the member's own hardware. The sandbox runs on
Cloudflare. The room cannot read it, the other members cannot read it, and the
operator of this site could, in the sense that any host can open its own
containers. That is a weaker promise than a draft in `localStorage` and
`COMPUTER.md` says so in the same words. It is still a far stronger promise
than the usual arrangement, where every agent's working files pass through the
shared server as a matter of course.

The endpoint is a pass-through that stores nothing, but "stores nothing" is a
claim about code you can read, not a guarantee you can verify from outside.

## Capability links are bearer secrets

Creating a room mints two links. The secret in the link is the credential, only
its hash is stored, and the Durable Object enforces which role may settle an
approval. There are no accounts, deliberately, because a judge has to be able
to open a link and use the thing and because a room that knew who its members
were would need a server that knew too.

The cost is that anyone holding a link is that role. There is no revocation, no
rotation, and no way to remove a member. A steward link pasted into the wrong
chat is a steward.

## A third-party product has now driven a room, through my adapter

On 2026-08-30 Claude Code drove a room end to end over the MCP bridge:
read the board, drafted twice privately, submitted one, asked to publish, was
parked, and reported that nothing had shipped without retrying. The transcript
and the room's log are in
`evidence/claude-code-drives-a-room-2026-08-30.md`.

That is a real product, not one of mine, doing the thing the design is about.
What it is not is a product that speaks WebMCP: it speaks MCP, and the bridge
in between is my code. No shipping agent product supports WebMCP today.
ChatGPT's site tools want a paid Work plan, and Chrome's side panel does not
call these tools at all.

## The older version of this note

The site hosts its own agent, and the reason is documented rather than hidden:
Chrome's Gemini side panel does not call WebMCP tools, and ChatGPT's site tools
want a paid Work plan, so without a hosted agent a visitor with no subscription
could not see the loop at all. The origin trial explicitly covers agents hosted
by the site.

What we can now show is narrower than "any agent" and wider than "our agent".
`scripts/foreign-agent.mjs` is a client that imports nothing from `src/`,
attaches from outside the browser, learns the room only through `getTools()`,
and drives it through `executeTool()`. It drafted, submitted, asked to publish,
got parked, checked once and reported honestly (`docs/EVIDENCE.md`, section 3).
So the descriptions are sufficient and the surface is genuinely the standard
one. But the client is still ours. Only its ignorance is guaranteed. A
third-party product such as ChatGPT's in-app browser has not been observed
doing this, and that remains the honest gap.

## We got a WebMCP fact wrong and shipped it before checking

This file existed to list the things we knew were weak, and then one of the
things we were confidently telling people turned out to be false.

We had written, in this repo and in the submission, that `getTools()` returns no
`inputSchema` and that a foreign agent therefore cannot discover how to call our
tools. Re-measuring on 2026-08-29 against Chrome 151 shows `inputSchema` is
returned. The real finding is smaller and more useful: Chrome hands it back as a
stringified `DOMString` rather than the object the spec has asked for since
webmcp#241 closed. `docs/WEBMCP-NOTES.md` now carries the measurement.

The correction matters more than the fact. An earlier measurement, written down
once and then quoted from memory, is how a project ends up asserting something
about a moving target that stopped being true. Everything else in this repo that
claims a number has a page that reruns it, and that is the reason why.

## The ablation is thirteen committed trials per arm, one model, one prompt

`docs/EVIDENCE.md` has the numbers and the method. The short version: the
guarded arm scores zero because it cannot do otherwise, so that half is a
property of the code and not a finding. The half worth reading is that the
model called the commit-tier tool in every trial of both arms after being told
not to.

This page also records that the earlier version of that claim was wrong. It
presented the two arms as a difference in what the model *chose*, quoting
unguarded trials that narrated the shortcut. The model called `publish` just as
often in the guarded arm; it simply hit an engine. A judge reading the
committed JSON would have caught that, and one did. The framing is corrected
and the raw output for every counted trial is in `docs/evidence/`.

Earlier runs whose transcripts were not kept are excluded from the count
rather than folded in.

## An endpoint that will forward a request to any public https address

Bringing your own model means the Worker posts your key and your conversation
to the endpoint you name. That endpoint is checked against the same address
guard the tool proxy uses, so loopback, the private ranges and the metadata
address are refused, but any public https host is allowed. On Cloudflare that
means this deployment can be used as a relay to public addresses by anybody
who can reach it. A production version would keep an allowlist of providers.

## The address guard checks every hop, and still guesses

`allowedUrl` runs on each redirect rather than only the first, which closes
the obvious way around it. It still checks hostnames and literals rather than
resolving them, so a public name that resolves to a private address is not
caught.

## The model can run out

Workers AI on the free plan allows 10,000 Neurons a day and errors rather than
charging when that is gone. The agent endpoint detects it and says so in plain
language instead of hanging. The room itself keeps working, because the room
works for a person alone, which is the "meaningfully better, not required"
claim we are making anyway. But a visitor who arrives after the allowance is
spent will not see an agent that day.

## The hosted model will loop on a question if you let it

Given a task, llama-3.3-70b runs it cleanly: asked to draft two options, submit
the better one and publish it, it calls draft_post twice, submit_for_review
once, publish once, gets parked, and often calls check_approval afterwards to
see whether the publish settled. Measured, more than once, against the deployed
origin.

Given a question rather than a task, the same model called the room's read tool
six times in a row and never answered. It is not the loop losing the tool
result: the result goes back as a user turn and the model can read it, and the
seventh call would have returned the same three posts as the first. It just
would not commit to writing the answer down, and the turn budget ran out.

So the room's agent refuses a tool call it has already made this turn with the
same arguments, and tells the model the answer is above and to reply in words.
Six calls became one, with an answer. Nothing is invented by the guard, and the
work log still records only calls that really ran.

The obvious alternative was a bigger model, so it was measured rather than
assumed: gpt-oss-120b, the other agentic model on this account, deployed and
given the same two prompts. It was worse at both. On the member task it took
26 seconds and five calls and then ran out of turns without telling the person
anything, where llama took 14 and three and named the handle. On the steward
task it called send_back, which nobody asked for, and reported a failure. So
the room stayed on llama-3.3-70b, which is also the model the ablation ran on.

Two things worth saying plainly about that. It is a workaround for one model's
behaviour, not a fix for anything, and a better model would not need it. And
the ablation harness deliberately leaves the guard off, because that measures a
bare loop and its committed transcripts were recorded without it, so the
numbers in EVIDENCE.md are still the numbers that were run.

## Signals are heuristics with no measured error rate

"Five drafts and nothing submitted" and "four agents failed the same
diagnostic" are counts over the event log, written by hand per room. They are
meant to be legible rather than clever. We have not measured how often they
fire on work that was fine, and with rooms this small the honest answer is that
we could not have.

## Rooms are not retained forever, and deleting one is not the end of it

The Durable Object keeps the most recent 500 operations and drops older ones,
so a long-lived room silently loses its early history. The steward can now
delete a room, which wipes its history and closes every connection, and
rotate the invite, which locks out everyone holding the old link. What delete
does not do is destroy the members' sandboxes: those are addressed by secrets
that live only in each member's browser, so only that browser can destroy
them, and a member who never comes back leaves a sandbox that Cloudflare
keeps until its idle timeout and its stored files after that. A real
deployment would want a sweep.

## A borrowed tool is only as trustworthy as where it came from

Adding a source needs a person, and the tier rules apply to what it brings.
Neither of those makes the far end honest. A borrowed tool's description is
written by whoever runs that API, and it arrives in the agent's context: an
OpenAPI summary is untrusted text, and the room marks every borrowed tool
`untrusted` for that reason. It cannot stop a description that argues for its
own use.

The address guard refuses loopback, the private ranges and the metadata
address by name and by literal. It does not resolve the hostname first, so a
public name pointing at a private address gets through. A deployment that
mattered would resolve and check, and would keep an allowlist.

Calls go out from the Worker, so the far end sees Cloudflare rather than the
member. There is no per-source credential store yet either: a source that
needs a key cannot be added at all, which is a gap rather than a decision.

## Bringing your own model means your key is in a browser

The key you paste sits in `localStorage` and is sent with each agent request
to this site, which forwards it to the endpoint you named and keeps nothing.
It never reaches the room, another member, or shared state.

That is still a key in a browser passing through somebody else's Worker. We
do not log it and there is no code that stores it, but "we store nothing" is a
claim about code you can read rather than something you can verify from
outside. Use a scoped or throwaway key, and revoke it afterwards.

## The door is a social gate, not an identity system

A steward can make each arrival wait to be let in, and the server enforces it:
an unadmitted member's ops are refused, not just hidden. What it is not is
proof of who somebody is. Identity here is a name in one browser, so a person
turned away can come back as somebody else with the same link. The fix is to
rotate the invite, which the steward can also do.

## The browser tool reads what the page says, not what the page does

`computer_browse` returns visible text after `domcontentloaded`. Pages that
render late, need a login, or block headless browsers come back short or
empty, and the tool says so only by its length. It is a reading tool, not an
agent inside a browser, and it does not click.

## What we deliberately did not build

No accounts, no timers, no per-person activity score, and no way to sort the
board by person. Those are omissions rather than gaps. A tool that shows a
manager who was slowest is a different product and one we did not want to make.
