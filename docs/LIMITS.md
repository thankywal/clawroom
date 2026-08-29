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

## Capability links are bearer secrets

Creating a room mints two links. The secret in the link is the credential, only
its hash is stored, and the Durable Object enforces which role may settle an
approval. There are no accounts, deliberately, because a judge has to be able
to open a link and use the thing and because a room that knew who its members
were would need a server that knew too.

The cost is that anyone holding a link is that role. There is no revocation, no
rotation, and no way to remove a member. A steward link pasted into the wrong
chat is a steward.

## No third-party agent has driven this end to end

The site hosts its own agent, and the reason is documented rather than hidden:
Chrome's Gemini side panel does not call WebMCP tools, and ChatGPT's site tools
want a paid Work plan, so without a hosted agent a visitor with no subscription
could not see the loop at all. The origin trial explicitly covers agents hosted
by the site.

But it is still true that we have not watched a third-party agent complete a
room task. The closest evidence we have is `/selftest`, which drives every tool
through `document.modelContext.executeTool()` with no agent code whatsoever, so
the tools are demonstrably on the standard surface and callable by anything
that speaks it. That is not the same as having seen one do it.

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

## The ablation is ten trials, one model, one prompt

`docs/EVIDENCE.md` reports 0/10 against 10/10 and says there what it means. The
short version: the guarded arm scores zero because it cannot do otherwise, so
that half is a property of the code and not a finding. The unguarded half is a
real measurement of a small sample. It settles whether the two designs differ
observably. It does not put a rate on how often models in general ignore a tool
description, and it should not be quoted as though it did.

## The model can run out

Workers AI on the free plan allows 10,000 Neurons a day and errors rather than
charging when that is gone. The agent endpoint detects it and says so in plain
language instead of hanging. The room itself keeps working, because the room
works for a person alone, which is the "meaningfully better, not required"
claim we are making anyway. But a visitor who arrives after the allowance is
spent will not see an agent that day.

## Signals are heuristics with no measured error rate

"Five drafts and nothing submitted" and "four agents failed the same
diagnostic" are counts over the event log, written by hand per room. They are
meant to be legible rather than clever. We have not measured how often they
fire on work that was fine, and with rooms this small the honest answer is that
we could not have.

## Rooms are not deletable and not retained forever

`Forget` in the lobby removes a room from this browser's list. It does not
delete the room. The Durable Object keeps the most recent 500 operations and
drops older ones, so a long-lived room silently loses its early history, and
there is no endpoint that removes a room outright. Neither behaviour is what a
real deployment should ship.

## What we deliberately did not build

No accounts, no timers, no per-person activity score, and no way to sort the
board by person. Those are omissions rather than gaps. A tool that shows a
manager who was slowest is a different product and one we did not want to make.
