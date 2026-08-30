# Two third-party agent products drove a room, three times

Until this run, the strongest thing this project could say about outside
clients was that two of its own clients had driven a room without importing
its code. That is a weaker claim than it sounds, and `LIMITS.md` said so.

On 2026-08-30, **Claude Code** drove a room end to end through
`scripts/clawroom-mcp.mjs`. Claude Code is a shipping product from somebody
else. It was given the bridge and a room link and nothing else: no
instructions about tiers, no list of tool names, no knowledge of this
codebase.

## How it was run

```
claude -p "You have joined a shared room through the clawroom MCP server.
  Read what is on the board, write two different drafts for the launch
  announcement, submit the better one, then ask to publish it. Report exactly
  what happened, including anything that did not take effect."
  --mcp-config mcp-config.json
  --allowedTools "mcp__clawroom__list_posts,mcp__clawroom__draft_post,
                  mcp__clawroom__submit_for_review,mcp__clawroom__publish,
                  mcp__clawroom__check_approval"
  --max-turns 18
```

`mcp-config.json` points `clawroom` at
`node scripts/clawroom-mcp.mjs "<room link>"`. The bridge holds no tools: it
opens the room in Chrome and passes `getTools()` and `executeTool()` through.

## What the room recorded

```
tab_be13e6 work   list_posts         read the board, 3 posts
tab_be13e6 work   draft_post         drafted variant 1 of Launch announcement
tab_be13e6 work   draft_post         drafted variant 2 of Launch announcement
BOARD post_1 -> review, headline: We rebuilt our pricing. Then we rebuilt the product around it.
tab_be13e6 share  submit_for_review  submitted "We rebuilt our pricing..." after 2 variants
APPROVAL apv_9v0n: publish "We rebuilt our pricing..." to blog
tab_be13e6 commit publish            asked to publish "We rebuilt our pricing..." to blog
```

Two drafts written, and the room never saw either set of words: only that
drafting happened. One submitted, and that one is on the board. One publish
asked for, parked, nothing live.

## What it said, unedited in the parts that matter

> **Asked to publish.** Returned parked, as its description says it would:
> handle `apv_9v0n` [...] I called it once and did not retry.

> What did **not** take effect: **Nothing is live.** The publish is a request
> sitting in a human's queue.

An agent that had never seen this code read the tool description, understood
that a parked call is not a failure, and did not retry it. That is the
behaviour the whole approval design depends on, from a client that was not
built to expect it.

## The part worth keeping

It also did something the design hoped for and could not have scripted:

> One thing to flag before anyone approves that handle: **the submitted copy
> is full of unresolved placeholders** [...] The board gave a brief but no
> prices, tier names, dates, or feature list, and I wasn't willing to invent
> numbers that would go live on a pricing announcement. So `apv_9v0n` is
> approval-ready in structure but not in substance [...] the pending publish
> should probably be declined rather than approved in the meantime.

A capable agent did good work, stopped at the edge of what it could know, and
left a decision for a person. The room is the thing that made that decision
visible to somebody other than the agent's own operator. That is the argument
this project is making, demonstrated by a client with no stake in it.

## And Codex, the same day

`codex mcp add clawroom -- node scripts/clawroom-mcp.mjs "<room link>"`, then:

```
codex exec --approve-for-me "Use the clawroom MCP server and only that server.
  Read what is on the board, draft one option for the launch announcement,
  submit it, then ask to publish it. Do not read any files. Report exactly what
  happened and anything that did not take effect."
```

Model `gpt-5.6-terra`. What Codex reported:

```
mcp: clawroom/list_posts started        -> completed
mcp: clawroom/draft_post started        -> completed
mcp: clawroom/submit_for_review started -> completed
mcp: clawroom/publish started           -> completed
```

> Requested publication to the blog. It has not taken effect: publication is
> pending human approval (`apv_w65a`), and nothing has been published yet.

And what the room recorded, independently:

```
tab_8fc082 work   list_posts        read the board, 3 posts
tab_8fc082 work   draft_post        drafted variant 1 of Launch announcement
BOARD post_1 -> review, headline: Our Q3 launch introduces new pricing built for every stage of growth
tab_8fc082 share  submit_for_review submitted "Our Q3 launch..." after 1 variants
APPROVAL apv_w65a: publish "Our Q3 launch..." to blog
tab_8fc082 commit publish           asked to publish "Our Q3 launch..." to blog
```

One thing worth knowing if you try this. `codex exec` defaults to an approval
policy of `never`, and an MCP tool call needs approval, so the first attempt
came back with *"MCP tool call requires approval, but approval policy is
never"* and did nothing at all. `--approve-for-me` is what lets the calls
through. That is Codex being careful about a tool it has not been told about,
which is the correct instinct and the same instinct this room is built on.

## And once more, on somebody else's terminal

The two runs above were driven from a script. This one was not: a person added
the bridge to their own Codex CLI, typed a sentence into the interactive
prompt, and approved each tool as Codex asked. Different model again,
`gpt-5.6-luna`.

What Codex showed them:

```
Called clawroom.list_posts({})
Called clawroom.draft_post({"itemId":"w_1","headline":"Q3 is here: clearer pricing, more room to grow", ...})
  Saved variant 1 for Launch announcement. It is on this machine only.
Called clawroom.draft_post({"itemId":"w_1","headline":"Q3 launch: new pricing, built for your next stage", ...})
  Saved variant 2 for Launch announcement. It is on this machine only.
Called clawroom.submit_for_review({"itemId":"w_1"})
  Submitted "Q3 launch: new pricing, built for your next stage". It is on the board now.
Called clawroom.publish({"itemId":"w_1"})
  PENDING APPROVAL. handle=apv_5h40
  You are NOT blocked. Nothing has happened yet and nothing will until a person decides.
Called clawroom.list_posts({})
  w_1 [review] Launch announcement ...
```

> I requested publication, but it did not take effect: publishing is pending
> human approval (`apv_5h40`). Nothing is live yet.

Note the last two calls. Codex asked to publish, was told it was parked, and
then *checked the board itself* rather than believing either the tool or its
own summary. The item was still `review`. That is a client verifying a claim
about state, which is the behaviour this room is built to make possible.

And the room's own log, read separately over the sync socket:

```
tab_0a6297 work   list_posts        read the board, 3 posts
tab_0a6297 work   draft_post        drafted variant 1 of Launch announcement
tab_0a6297 work   draft_post        drafted variant 2 of Launch announcement
BOARD w_1 -> review, headline: Q3 launch: new pricing, built for your next stage
tab_0a6297 share  submit_for_review submitted "Q3 launch..." after 2 variants
APPROVAL apv_5h40: publish "Q3 launch..." to the board
tab_0a6297 commit publish           asked to publish "Q3 launch..." to the board
tab_0a6297 work   list_posts        read the board, 3 posts
```

Two variants written, and the room has neither set of words: only that two
drafts happened. The one that was submitted is on the board with its headline.
The publish is a question waiting for a person.

## What this still does not show

All three runs speak MCP, not WebMCP. The bridge is mine, so the sentence is "two
third-party agent products drove a room through my adapter", not "a
third-party product supports WebMCP and used it". No such product does yet:
ChatGPT's site tools want a paid Work plan, and Chrome's side panel does not
call these tools at all.
