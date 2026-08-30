# Devpost submission form: the answers to paste

Everything else is already filled in on https://devpost.com/software/clawroom.
These nine fields are asked at the moment you press Submit.

| field | answer |
|---|---|
| Submitter Type | **Individual** |
| Country of residence | **Myanmar** (or whichever is correct for you) |
| Organization name | leave blank |
| App Status | **New** |
| If Existing, what you updated | leave blank |
| Live URL | `https://clawroom.thankywal-bkk.workers.dev` |
| Testing instructions | see below |
| Public code repo | `https://github.com/thankywal/clawroom` |
| Which agents or clients did you test with | see below |
| Which AI tools did you use | see below |
| Level of learning | **Significant** |
| AI value for your career | **Yes** |

## Testing instructions

No credentials, no signup, no browser flags. The origin trial token is served
in every page, so plain Google Chrome 149+ works as installed. Please use
Chrome: that is the path this project was verified on. ChatGPT's in-app browser
has not been tested against it, because site tools there need a paid Work plan
I do not have. The tools are registered imperatively in the main document with
no iframes, so nothing known should stop it, but I have not seen it.

Open https://clawroom.thankywal-bkk.workers.dev in Chrome and press **Open the
demo room**. You land in a marketing room as the manager, and a second window
opens as Ella, one of your team. Ella's agent has already run a short real
sequence, so your window opens with a log and one action waiting on you, with
the words it would ship printed in the card. Approving it is the whole loop in
one click.

To drive it yourself, in Ella's window type into the agent box:

    Draft two options for the launch announcement, submit the better one, then publish it.

Watch Ella's agent draft privately, submit one version, and ask to publish. The
publish will not publish. It returns a handle and parks. Switch to the manager
window and approve it.

Then give Ella's agent its computer:

    On your computer, save the pricing explainer brief to brief.txt, write a
    Python script that counts the words in it, run the script, then share the
    script to the board.

The manager's log shows that files were written and a command ran, with the
exit code, and never the script or its output. Under "On this machine" in
Ella's window there is a console into the same computer: type `ls -la` and it
runs through the same computer_run tool, so the manager's log gets one more
line and nothing else. The manager's window has a "Computers in this room"
table with counts per member, a "Rotate invite" and a "Delete room" button.

Under **Your agent**, on either window, press **connect one** for the exact
command that attaches Claude Code or Codex to that room over MCP, with the
link already in it. Claude Code and Codex have both driven a room this way;
the transcripts and the room's own log are in `docs/evidence/`. In Codex's
interactive CLI you allow each tool as it asks; `codex exec` needs
`--approve-for-me`, because its default approval policy refuses MCP calls.

The room switcher at the top holds five rooms. "Order desk" was generated
from an OpenAPI file by `npm run generate`; its refund and cancel tools park
for the desk lead the same way publish does.

Two pages test the claims without any agent at all:

- /selftest.html calls every tool through document.modelContext.executeTool()
  with no agent involved. 22 of 22 pass, nine of which test a claim rather than
  a function: a sentinel sentence hunted through all of shared state, a publish
  that must leave the board unmoved until a person clicks, a canary in a file on
  the sandbox, a page served on a port, a snapshot that survives rm -rf, and a
  borrowed refund that parks.
- /ablate.html removes the tier engine and measures what a model does when only
  the tool description asks it to wait for a human. Takes a few minutes.

If the Workers AI free allowance for the day is spent, the agent says so and the
room walks a rehearsed sequence instead. Those tool calls are still real and
still go through executeTool. Only the choice of calls is scripted, and the room
says so before the first one runs.

## Which agents or clients did you test your WebMCP tools with

Seven paths. Five worked, two did not, and the two that did not are part of
the finding.

1. A site-hosted in-page agent, the one the demo uses. The tool-calling loop
   runs in the browser over document.modelContext.executeTool() with a
   stateless Cloudflare Workers AI proxy behind it (gpt-oss-120b during
   development, llama-3.3-70b for the recorded runs). The origin trial covers
   agents hosted by the site.
2. A foreign client that has never seen the code. scripts/foreign-agent.mjs
   attaches from outside the browser over CDP, imports nothing from src/, and
   learns the room only through getTools(). It drafted, submitted, asked to
   publish, was parked, checked once, and reported honestly. Transcript in
   docs/evidence/.
3. **Claude Code**, through an MCP bridge I wrote: scripts/clawroom-mcp.mjs
   holds no tools, opens the room in a real Chrome, and passes getTools() and
   executeTool() through. Given a link and nothing else it read the board,
   drafted twice privately, submitted one, asked to publish, was parked, and
   said so without retrying. It also flagged that its own copy was full of
   placeholders and that the pending publish should be declined rather than
   approved. Transcript in docs/evidence/.
4. **Codex**, through the same bridge, twice. Once non-interactively on
   gpt-5.6-terra, and once from a person's own interactive CLI on
   gpt-5.6-luna, approving each tool as Codex asked. In the second run, after
   being parked, Codex called list_posts again and read the board itself
   rather than believing the tool or its own summary, and found the item still
   in review. Worth knowing: codex exec defaults to an approval policy of
   never and refuses MCP calls outright until you pass --approve-for-me.
5. No agent at all. /selftest.html drives every tool through executeTool()
   directly, in a clean Chrome profile with no flags. 22 of 22.
6. Chrome's Ask Gemini side panel. It does not call WebMCP tools. Given a room
   and a task it ran a Google search, read the page, and reported constraints
   it had stored and options it had proposed. None of it had happened and the
   activity log stayed empty. Written up in docs/WEBMCP-NOTES.md.
7. ChatGPT's in-app browser. Site tools there need a paid Work plan I do not
   have, so it is untested. Nothing known should stop it: the tools are
   registered imperatively in the main document, no iframes, no declarative
   API.

Browser: Chrome 151.0.7922.175, against the deployed origin rather than
localhost. The ablation (docs/EVIDENCE.md) ran the in-page path eight times per
arm, with every transcript committed; thirteen committed trials per arm in
total across two runs.

No shipping agent product speaks WebMCP itself yet, so paths 3 and 4 reached
the room through my adapter. That is stated plainly in docs/LIMITS.md rather
than glossed.

## Which AI tools have you leveraged

- **Claude Code** for the whole build: engine, Worker, Durable Object, rooms, UI,
  the ablation harness, and the demo film's capture and edit pipeline.
- **Cloudflare Workers AI** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) as the
  in-page agent's model, and as the subject of the ablation.
- **ChatGPT** for thinking through the framework framing early on, before any of
  the tool-source work was written.
- **Codex** and **Claude Code** as clients rather than as builders: both were
  attached to a live room over MCP to check that an agent nobody here wrote
  behaves the way the tool descriptions promise.
- **Chrome's Ask Gemini** side panel, tested as a WebMCP client. It did not call
  the tools, which changed the architecture: the site hosts its own agent
  because otherwise a visitor with no subscription could not see the loop at all.
- **Google Chirp 3 HD** for the demo film's narration and **Lyria** for an early
  music bed that was cut.

## Still to do before you press Submit

1. The film is on YouTube at https://youtu.be/c9gOER5Djeo and the URL is on
   the Devpost project. Check it is **public or unlisted**, never private: a
   judge has to be able to open it without being invited.
2. Rotate the Devpost access token and refresh token that were pasted into the
   chat, since they are now in a session log on disk.
