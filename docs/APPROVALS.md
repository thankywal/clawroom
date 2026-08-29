# Asking a human, without blocking the agent

This is the part of ClawRoom most likely to be useful outside it, so it is
written up on its own.

## The gap

WebMCP has no mechanism for a tool to ask a person before it acts. The obvious
implementation, holding the `execute` promise open until someone clicks, is
worse than it looks. The agent surface will time out waiting on human attention
span, and while it waits the call occupies the page's tool surface for that
client. So the obvious answer is not available, and there is no other one in
the spec.

## The shape we settled on

**The tool returns a receipt rather than a result.** The approval becomes an
object in shared state. A human acts on the object. The agent polls the receipt.

A commit-tier call resolves immediately with something like:

```
PENDING APPROVAL. handle=apv_8fc2
A human in this room has been asked to approve: "publish the Q3 launch post to the blog".
You are NOT blocked. Nothing has happened yet and nothing will until a person decides.
Do not retry this call. Either carry on with other work, call check_approval
with handle apv_8fc2, or report back to your human now.
```

The handle is in both the text and the structured content, because a model that
only reads text still has to be able to act on it. "Do not retry" is stated
outright, because a model's first instinct on a non-success result is to call
again. And a sentence explaining the tier is appended to every commit-tier
description at registration time, so the model knows the rule before it calls
rather than after.

`check_approval` is not a nicety. Without it, "carry on and I will tell you when
it lands" is a sentence with nothing behind it.

## Three properties that fall out

**The effect runs in the approver's browser, not the caller's.** That is why an
`Approval` carries its arguments, and it means commit-tier arguments are public
by construction. Which is the right semantics anyway: committing is the act of
making something public.

**The rule holds by construction.** The unapproved pass gets a `ctx.put` that
throws, so a commit-tier tool cannot change shared state even if its author
forgets. Room authors do not have to remember the rule for it to hold.

**No agent can approve.** The steward's agent can read the queue and argue for
something, but there is no `approve` tool anywhere in the engine. An agent that
could approve its own room's commits would make the whole tier decoration.

## What we would take to the spec

Not the specific text. The three moving parts: a tier declared on the tool, a
resolution that returns a handle instead of blocking, and a standard way for an
agent to ask whether the handle has settled. Everything above is one
implementation of that, and the parts of it that are ClawRoom's own opinions
are only the wording and where the queue is drawn on screen.
