# Where your agent runs

A room is a page. Everything in it, including the tier engine, lives in the
document, because that is where WebMCP puts a tool surface. So the question
"where does my agent run" is really "whose browser has the room open".

There are four honest answers, and you pick.

## 1. Your tab

Open the room and use the agent the site hosts. It is a 70B on Workers AI,
there for the visitor who has nothing else, and it is the only option that
needs no setup at all.

## 2. Your tab, your model

Under the composer, `use your own`. Any OpenAI-compatible endpoint, with
presets for OpenAI, Groq and OpenRouter. The key stays in your browser and is
forwarded once per request; nothing stores it. See LIMITS.md.

## 3. Your machine, your coding agent

    npm run room

That makes a room and prints both links plus the exact command to paste. Or by
hand:

    claude mcp add clawroom -- node scripts/clawroom-mcp.mjs "<member link>"
    codex  mcp add clawroom -- node scripts/clawroom-mcp.mjs "<member link>"

Give it the **member** link. The steward link is the person who approves, and
an agent holding it gets five read-only tools and nothing to do.

In Codex's interactive CLI you will be asked to allow each tool the first time,
which is the normal path. `codex exec` defaults to an approval policy of
`never` and refuses MCP calls outright with *"MCP tool call requires approval,
but approval policy is never"*, so non-interactive runs need
`--approve-for-me`.

The bridge holds no tools. It opens the room in a real Chrome and passes
`getTools()` and `executeTool()` through. Your agent is whatever you already
pay for; the room is unchanged; commit-tier calls still park for a person.

## 4. A machine that is not yours to watch

    node scripts/clawroom-mcp.mjs "<room link>" \
      --away "Draft two options for the pricing explainer, submit the better one,
              then ask to publish it."

Run that on a VM, a spare box, anything that stays awake. The room is simply
open somewhere else: its own in-page agent does the work, and you read the log
in the morning. Set `CLAWROOM_MODEL_BASE`, `CLAWROOM_MODEL_KEY` and
`CLAWROOM_MODEL` first and the away agent uses your model rather than the
site's.

What came back from a real run:

    What the room saw while you were away (4 entries):
      Away local  draft_post        drafted variant 1 of Launch announcement
      Away local  draft_post        drafted variant 2 of Launch announcement
      Away shared submit_for_review submitted "Pricing Explainer" after 2 variants
      Away commit publish           asked to publish "Pricing Explainer" to blog

    Waiting on a person (1):
      Away asked to publish "Pricing Explainer" to blog, apv_ug6y

    Nothing in that list has happened. It will not until somebody in the room
    approves it.

That is the shape worth having. An agent can work all night. It cannot ship
anything all night. You wake up to a queue of decisions rather than to a
surprise.

There is no daemon here, deliberately. `--away` runs one task and reports. If
you want an agent present overnight, run it under whatever supervises your
other jobs.

## Why not Cloudflare Browser Rendering

The obvious way to offer "run my agent in the cloud" from a site that already
runs on Cloudflare is Browser Rendering, which this project already uses for
`computer_browse`. It does not work for this, and the reason is worth
publishing.

`/api/cloudprobe` opens any URL in that browser and reports what the page can
see. Against a live room:

    "ua": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)
           HeadlessChrome/128.0.0.0 Safari/537.36"
    "probe": { "namespace": null, "tools": 0, "keys": [] }

Chrome 128. WebMCP arrived in 151. There is no `document.modelContext` there
at all, so a browser in that cloud cannot join a room no matter how it is
driven. The probe is committed rather than deleted, because a measured no is
worth more than an assumption either way, and because the same check will
answer yes one day without anybody changing the code.

The alternative would have been to run the tier engine a second time, server
side, and let a cloud agent drive the room through that. Two enforcement
points, one of which drifts, and a project whose central claim is that the
rule is enforced in one place by construction. Not worth it.

## Or run the whole room yourself

Everything above assumes the room is hosted here. It does not have to be.

    git clone https://github.com/thankywal/clawroom
    npm install
    npx wrangler deploy

That gives you your own Worker, your own Durable Objects, your own Sandboxes
and your own Workers AI account, on your own Cloudflare. The origin trial
token in `index.html` is bound to this origin, so replace it with one for
yours, or run Chrome with `--enable-features=WebMCP` while you test.

Nothing in the engine points back here. The Durable Object never learns what
kind of room it is holding, and the sandbox addresses live only in members'
browsers, so a deployment of your own shares nothing with this one.
