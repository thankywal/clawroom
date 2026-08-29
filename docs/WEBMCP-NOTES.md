# Verified WebMCP surface

Measured, not assumed. `public/smoke.html` is the diagnostic that produced this;
it ships with the project so anyone can re-run it.

Chrome 151 · macOS · https://clawroom.thankywal-bkk.workers.dev
Two runs: one with `chrome://flags/#enable-webmcp-testing`, one in a **clean
profile with no flags**, relying only on the origin trial token. Identical
results — which is the point: a judge does not have to configure anything.

## Namespace

Both are present; `document` is the one the spec settles on.

    document.modelContext    yes
    navigator.modelContext   yes

Resolve once at startup and use the result everywhere:

    const mc = document.modelContext || navigator.modelContext || null;

## Methods

    registerTool()    yes
    getTools()        yes
    executeTool()     yes
    provideContext()  no
    unregisterTool()  no      ← use an AbortSignal instead

## Behaviour confirmed

| | |
|---|---|
| `execute` returning a bare string | works |
| `execute` returning `{content:[{type:'text',text}]}` | works |
| `structuredContent` alongside `content` | works |
| `annotations: { readOnlyHint, untrustedContentHint }` | accepted |
| `execute(args, ctx)` second argument | delivered |
| `registerTool(def, { signal })` then `abort()` | **unregisters** — `getTools()` went 5 → 4 |

The last row is the load-bearing one for Council. There is no
`unregisterTool()`, so a tool surface that changes with page state depends
entirely on AbortSignal. The Chrome docs associate this with 153+; it works on
151. Council registers its private-zone tools under one controller so the whole
surface can be withdrawn at once.

## Origin trial

    origin   https://clawroom.thankywal-bkk.workers.dev:443
    feature  WebMCP
    expiry   2026-11-17

Delivered as a `<meta http-equiv="origin-trial">` tag in every page. Subdomain
matching is unavailable here — `workers.dev` is on the Public Suffix List, so
the token is bound to this exact origin. Third-party matching is not needed:
Council's tools are registered by the page itself, on its own origin.

## `executeTool()` returns a string

Worth knowing before you write anything against it: `executeTool(tool, jsonArgs)`
resolves to the result envelope **serialised as JSON**, not as an object. So a
tool that returns `{ content:[{type:'text',text:'{"feasible":false}'}] }` comes
back needing two parses — the envelope, then the payload inside `content[].text`:

    let env = await mc.executeTool(tool, JSON.stringify(args));
    if (typeof env === 'string') env = JSON.parse(env);
    const text = env.content.map(c => c.text).join('');
    const data = env.structuredContent ?? JSON.parse(text);

`public/selftest.html` exercises all eight Council tools this way and reports
pass/fail in the page. It needs no agent, which makes it the honest answer to
"do these tools actually work" — 8/8 against the deployed origin in a clean
Chrome profile with no flags set.

## What did not work

Chrome's **Ask Gemini** side panel did not call the tools. Given the same
prompt it ran a Google Search, read the page, and reported constraints it had
"stored" and options it had "proposed" — none of which had happened; the page's
activity log stayed empty. Useful to know that a agent surface being adjacent to
the page does not mean it speaks WebMCP, and that a model will narrate the
actions it did not take.
