# Verified WebMCP surface

Measured, not assumed. `public/smoke.html` is the diagnostic that produced this;
it ships with the project so anyone can re-run it.

Chrome 151 · macOS · https://clawroom.thankywal-bkk.workers.dev
Two runs: one with `chrome://flags/#enable-webmcp-testing`, one in a **clean
profile with no flags**, relying only on the origin trial token. Identical
results, which is the point: a judge does not have to configure anything.

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
| `registerTool(def, { signal })` then `abort()` | **unregisters**, `getTools()` went 5 to 4 |

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
matching is unavailable here because `workers.dev` is on the Public Suffix List, so
the token is bound to this exact origin. Third-party matching is not needed:
Council's tools are registered by the page itself, on its own origin.

## `executeTool()` returns a string

Worth knowing before you write anything against it: `executeTool(tool, jsonArgs)`
resolves to the result envelope **serialised as JSON**, not as an object. So a
tool that returns `{ content:[{type:'text',text:'{"feasible":false}'}] }` comes
back needing two parses: the envelope, then the payload inside `content[].text`:

    let env = await mc.executeTool(tool, JSON.stringify(args));
    if (typeof env === 'string') env = JSON.parse(env);
    const text = env.content.map(c => c.text).join('');
    const data = env.structuredContent ?? JSON.parse(text);

`public/selftest.html` exercises all eight Council tools this way and reports
pass/fail in the page. It needs no agent, which makes it the honest answer to
"do these tools actually work". 8/8 against the deployed origin in a clean
Chrome profile with no flags set.

## What did not work

Chrome's **Ask Gemini** side panel did not call the tools. Given the same
prompt it ran a Google Search, read the page, and reported constraints it had
"stored" and options it had "proposed". None of it had happened; the page's
activity log stayed empty. Useful to know that a agent surface being adjacent to
the page does not mean it speaks WebMCP, and that a model will narrate the
actions it did not take.

## Chrome 151 is a spec revision behind on the string to object migration

An earlier version of this file said `getTools()` returns no `inputSchema` at
all. That was wrong, and re-measuring it on 2026-08-29 is what found the more
interesting fact underneath.

Measured on Chrome 151.0.7922.175 against the deployed origin, one entry from
`getTools()` carries:

    { name, title, description, inputSchema, annotations, origin, window }

So the schema is there. What is not there yet is the type the spec now asks
for. [webmcp#241](https://github.com/webmachinelearning/webmcp/issues/241),
closed on 2026-08-14, changed `RegisteredTool#inputSchema` from a stringified
`DOMString` to an `object`, to match `ModelContextTool#inputSchema` and the MCP
tool listing spec. Chrome 151 still hands back the string:

    typeof tool.inputSchema                  // "string"
    JSON.parse(tool.inputSchema).type        // "object"

The same lag shows in `executeTool()`, which still takes a JSON string for its
arguments even though [#243](https://github.com/webmachinelearning/webmcp/issues/243)
and [#246](https://github.com/webmachinelearning/webmcp/issues/246) both closed
in favour of passing an object. Both are implementation lag rather than spec
gaps, and both are worth knowing before you write a client: if you type
`inputSchema` as an object you will get a string, and if you feed `executeTool`
an object today it will not do what the current spec says it should.

ClawRoom builds the model's tool list from the room definition it already holds
rather than from `getTools()`, which was originally a workaround for a gap that
turned out not to exist. It stays because the room definition is the source of
truth for what a room's tools mean, and because a client that parses whichever
shape the browser happens to ship this month is a client that breaks twice.
`getTools()` is still used for the opaque handle `executeTool` wants.

`ontoolchange` also exists on the `ModelContext` prototype and we do not use
it. Anyone building a tool surface that changes underneath a long lived agent
probably should.

## Two response shapes from Workers AI

Not a WebMCP fact, but it cost an hour and it will cost someone else one.
Workers AI answers in two different shapes depending on the model. Some return
a flat envelope:

    { response: "...", tool_calls: [{ name, arguments }] }

Others return the OpenAI choices envelope:

    { choices: [{ message: { content, tool_calls: [{ function: { name, arguments } }] } }] }

Read only the first and tool calling still appears to work, because the calls
come through, while the model's closing message is silently always empty. There
is no error. `worker/llm.ts` reads both, and synthesises call ids, since the
flat shape has none.


## Cloudflare Browser Rendering has no WebMCP (measured 2026-08-30)

A site that runs on Cloudflare and wants to offer "run my agent in the cloud"
reaches for Browser Rendering. It cannot be used for WebMCP work yet.

    GET /api/cloudprobe?url=<a live room>

    "ua": "Mozilla/5.0 (X11; Linux x86_64) ... HeadlessChrome/128.0.0.0 ..."
    "probe": { "namespace": null, "tools": 0, "keys": [] }

Chrome 128 against an API that landed in 151. Neither `document.modelContext`
nor `navigator.modelContext` exists, and no property of `document` matches
/model/i, so this is absence rather than a naming difference or a missing
origin trial token.

The probe stays in the repo. It is four lines of page script and it will
answer yes the day that image moves forward, without anybody editing it.
