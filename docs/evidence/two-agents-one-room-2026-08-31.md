# Two agents, one room, at the same time

2026-08-31, against the deployed origin.

The writeup says a room is for a team. This is the smaller case, and the one
that is true today rather than soon: one person running more than one coding
agent at once, which is an ordinary Tuesday for anybody with both Claude Code
and Codex installed.

## How it was run

One room, made from the campaign definition. Two copies of the MCP bridge
started within a second of each other, both pointed at the same member link,
each with its own name:

    node scripts/clawroom-mcp.mjs "<member link>&as=Claude" --selftest
    node scripts/clawroom-mcp.mjs "<member link>&as=Codex"  --selftest

`--selftest` is the bridge exercising the room's own tools through
`getTools()` and `executeTool()` with no model in the loop, which is what makes
this a test of the room rather than a test of a model. Two of the calls in it
are deliberately wrong, so `draft_post` with no arguments and the
`submit_for_review` that follows it are the room refusing, not the room failing.

A third window was then opened as the steward, and everything below is read out
of that window. Neither bridge wrote it.

## What the room recorded

    live, 3 in the room

    Claude  local   list_posts          read the board, 3 posts
    Codex   local   list_posts          read the board, 3 posts
    Codex   local   draft_post          A draft needs both a headline and copy.
    Claude  local   draft_post          A draft needs both a headline and copy.
    Claude  shared  submit_for_review   Nothing drafted for that post yet.
    Codex   shared  submit_for_review   Nothing drafted for that post yet.
    Claude  commit  publish             asked to publish "Launch announcement" to blog
    Codex   commit  publish             asked to publish "Launch announcement" to blog
    Claude  local   check_approval      checked apv_ir7e
    Codex   local   check_approval      checked apv_d6hq

    Claude asked to publish "Launch announcement" to blog
      apv_ir7e, waiting since 12:46:10 PM
    Codex asked to publish "Launch announcement" to blog
      apv_d6hq, waiting since 12:46:10 PM

## What is worth noticing

The lines interleave. Both agents were working at the same second, and the log
still says which one did what, because the server stamps the sender from the
socket rather than believing the envelope.

They got different handles. `apv_ir7e` is Claude's and `apv_d6hq` is Codex's,
and each `check_approval` went to its own. Two agents asked to publish the same
item; the room did not merge them into one request, and neither one shipped.

Two approvals were waiting on a person at the end of it. That is the whole
point of the smaller case: you can have two agents running while you are not
looking at either of them, and what you come back to is a queue of decisions
rather than a pile of published work you did not ask for.

Each agent also has its own sandbox in this room, addressed by a secret only
that seat holds, so `computer_run` in one is not visible from the other.

## What this does not show

No model was making the choices. This is the room and the bridge, not an
argument about whether Claude Code or Codex is good at the task. The runs where
models did choose are in `claude-code-drives-a-room-2026-08-30.md`.
