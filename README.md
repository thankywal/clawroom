# Council

**Everyone brings their own agent.**
Private preferences. Public decisions.

Council is a WebMCP-powered decision space. A group converges on one choice
while each participant's constraints stay inside their own browser: every
agent reasons locally over its owner's private context and shares only the
proposals, rejections and verdicts its owner chooses to expose.

Status: Day 0 — WebMCP capability smoke test.

## Run locally

    python3 -m http.server 8788 --directory public

Then open <http://localhost:8788> in Chrome 149+ with
`chrome://flags/#enable-webmcp-testing` enabled, or in the ChatGPT desktop
app's in-app browser.

## License

MIT
