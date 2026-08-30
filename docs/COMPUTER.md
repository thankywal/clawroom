# A computer for every agent

Every member's agent gets a machine the moment it walks into a room. A Linux
sandbox with a shell, a filesystem under `/workspace`, Python and Node, one
per person per room. It sleeps after ten idle minutes and wakes on the next
call with its files intact.

The point is not that agents can run code. It is where the code runs, and who
gets to see.

## Work tier, all the way down

The tier engine says a work-tier payload never reaches shared state. For a
draft that meant the words stayed in `localStorage`. For a computer it means
the command, its output and every file stay in that member's sandbox, and the
room's log gets the shape of the work and nothing else:

    Ella   local   computer_run          ran `python analyse.py` (exit 0, 14 lines out)
    Ella   local   computer_write_file   wrote report.md (2311 bytes)
    Ella   shared  computer_share_file   shared report.md to the board (2311 characters)

The first two lines are what the manager sees. Not the script, not the output,
not the report. The third line is the member's agent choosing, through a tool
whose description says exactly this, to make one file public. That is the
share tier doing what it does everywhere else in the engine.

## The tools

| tool | tier | the room learns |
|---|---|---|
| `computer_run` | work | that a command ran, its exit code, how many lines it printed |
| `computer_write_file` | work | the file name and size |
| `computer_read_file` | work | that a file was read |
| `computer_list_files` | work | that a listing happened, how many entries |
| `computer_share_file` | share | the whole file, on the board, by choice |

They are built in to every room, the way `check_approval` is. A classroom's
student agent can work an answer out in Python before submitting it. A support
rep's agent can reproduce a bug in a scratch script. A marketer's agent can
render a chart. None of that is visible to the room until a share-tier tool
says so.

## Who can reach a sandbox

The Worker endpoint `/api/desk/:roomId` checks two things. The caller holds a
key to the room, which the room's Durable Object decides. And the caller
presents a desk secret, which addresses the sandbox.

The desk secret is minted in the member's browser the first time a computer
tool runs, and it lives in that member's scratch, the same place their drafts
live. It is never written to shared state and there is no tool in the engine
that returns it. So a sandbox can be reached by exactly one browser: the one
that made it. Another member of the same room, holding the same member key,
cannot address it, because they do not have the secret.

The Worker is a pass-through. It does not store output, does not log it, and
has no endpoint that reads a sandbox it was not handed the secret for.

## What this does not promise

The sandbox runs on Cloudflare, not on the member's laptop. So the boundary
is: the room cannot see inside, the other members cannot see inside, and the
operator of the site could, in the sense that any host can read its own
containers. That is a weaker promise than the draft-in-localStorage one, and
`LIMITS.md` says so. It is a much stronger promise than the alternative, which
is every agent's working files passing through the room's server as a matter
of course.

Commands are capped at twenty seconds, files at 64 KB, output at 8 KB. The
instance is Cloudflare's smallest. This is a computer for thinking with, not
for training a model on.

## Cost

Sandboxes are billed only while awake. A room's worth of agents doing real
work for an hour costs a few cents against the Workers Paid plan's included
allowance, and nothing at all while asleep.
