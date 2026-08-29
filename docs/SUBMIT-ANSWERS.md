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
in every page.

Open https://clawroom.thankywal-bkk.workers.dev in Chrome and press **Open the
demo room**. You land in a marketing room as the manager, and a second window
opens as Ella, one of your team. In Ella's window, type into the agent box:

    Draft two options for the launch announcement, submit the better one, then publish it.

Watch Ella's agent draft privately, submit one version, and ask to publish. The
publish will not publish. It returns a handle and parks. Switch to the manager
window and approve it.

Two pages test the claims without any agent at all:

- /selftest.html calls every tool through document.modelContext.executeTool()
  with no agent involved. 10 of 10 pass.
- /ablate.html removes the tier engine and measures what a model does when only
  the tool description asks it to wait for a human. Takes a few minutes.

If the Workers AI free allowance for the day is spent, the agent says so and the
room walks a rehearsed sequence instead. Those tool calls are still real and
still go through executeTool. Only the choice of calls is scripted, and the room
says so before the first one runs.

## Which agents or clients did you test your WebMCP tools with

Four paths, and only two of them worked, which is itself a finding.

1. **A site-hosted in-page agent**, which is the one the demo uses. The
   tool-calling loop runs in the browser over document.modelContext.executeTool()
   with a stateless Cloudflare Workers AI proxy behind it. The origin trial
   covers agents hosted by the site.
2. **No agent at all.** /selftest.html drives every tool through executeTool()
   directly, in a clean Chrome profile with no flags. 10 of 10.
3. **Chrome's Ask Gemini side panel.** It does not call WebMCP tools. Given a
   room and a task it ran a Google search, read the page, and reported
   constraints it had stored and options it had proposed. None of it had
   happened and the activity log stayed empty. Written up in
   docs/WEBMCP-NOTES.md.
4. **ChatGPT site tools.** Blocked behind a paid Work subscription, so untested.

Browser: Chrome 151.0.7922.175, against the deployed origin rather than
localhost.

## Which AI tools have you leveraged

- **Claude Code** for the whole build: engine, Worker, Durable Object, rooms, UI,
  the ablation harness, and the demo film's capture and edit pipeline.
- **Cloudflare Workers AI** (`@cf/openai/gpt-oss-120b`) as the in-page agent's
  model, and as the subject of the ablation.
- **Chrome's Ask Gemini** side panel, tested as a WebMCP client. It did not call
  the tools, which changed the architecture: the site hosts its own agent
  because otherwise a visitor with no subscription could not see the loop at all.
- **Google Chirp 3 HD** for the demo film's narration and **Lyria** for an early
  music bed that was cut.

## Still to do before you press Submit

1. Upload `/Users/nandar/clawroom-video/out/clawroom.mp4` to YouTube as
   **public or unlisted**, then paste the URL into the project's video field.
   The rules require a public YouTube video under 3 minutes. Ours is 2:13.
2. Rotate the Devpost access token and refresh token that were pasted into the
   chat, since they are now in a session log on disk.
