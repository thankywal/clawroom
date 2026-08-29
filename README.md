# ClawRoom

**Everyone brings an agent. The room sees the work, not the people.**

ClawRoom is git for agent work: a shared room where each person brings their own
AI agent, every tool call is a visible commit, the person in charge sees the
work without ever seeing the conversations, and nothing ships until a human
approves it.

One engine, many rooms. A room is a schema — who the steward is, what tools
members' agents get, what the steward's agent can see, and which call patterns
raise a flag. Swap the schema and the same engine runs a marketing department,
a classroom, a support desk, or a shop floor.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

## Status

Day 1. WebMCP foundation verified end to end:

- Origin trial token live, so the tools work with no browser flags set
- All tools exercised through `document.modelContext.executeTool()` — see `/selftest`
- Findings recorded in [`docs/WEBMCP-NOTES.md`](docs/WEBMCP-NOTES.md)

## Try it

    npx wrangler dev

Or open the deployed origin in Chrome 149+ or the ChatGPT desktop browser.
`/selftest` runs every tool without an agent and reports pass/fail in the page.

## Layout

    public/          the room — static, no build step
      js/state.js    room state, private zone, fit logic
      js/tools.js    WebMCP tool surface, grouped by zone
      js/ui.js       rendering
      selftest.html  every tool, called through executeTool()
      smoke.html     WebMCP capability diagnostic
    docs/            verified API surface, tool spec
    scripts/         CDP harness for headless verification

## License

MIT
