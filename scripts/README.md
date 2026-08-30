# scripts

## verify.mjs

Drives a headless Chrome over CDP, loads a page, and evaluates an expression
once it stops returning a pending value. Used to check the tool self-test
against the deployed origin without a human in the loop.

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --headless=new --disable-gpu --no-first-run \
      --remote-debugging-port=9333 --user-data-dir=/tmp/cprof about:blank &

    node scripts/verify.mjs https://clawroom.thankywal-bkk.workers.dev/selftest.html \
      "document.getElementById('tally').textContent.trim()"

`--dump-dom` is not enough here: it snapshots before the tool calls resolve.

## ablate.mjs

Runs `/ablate.html?auto=1&n=5` in that same Chrome and prints the tally:
guarded arm versus description-only arm. `npm run ablate`.

## foreign-agent.mjs

An agent that has never seen this code. Imports nothing from `src/`, learns
the room through `getTools()`, drives it through `executeTool()` over CDP.
`npm run foreign`.

## generate-room.mjs

An OpenAPI 3 document in, a ClawRoom room out.

    npm run generate -- docs/examples/orders-openapi.json \
      --id orders --title "Order desk" --steward "Desk lead" --member "Packer"

Every operation becomes a tool. Reads are work tier, writes are share tier,
and anything that sounds irreversible (delete, refund, publish, pay, ship...)
is commit tier and parks for a person. `x-clawroom-tier` on an operation
overrides the guess. Register the file in `src/rooms/index.ts` and it is in
the switcher. Until `BASE` is set in the generated file every call is a dry
run that still obeys the tiers.
