# verify.mjs

Drives a headless Chrome over CDP, loads a page, and evaluates an expression
once it stops returning a pending value. Used to check the tool self-test
against the deployed origin without a human in the loop.

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --headless=new --disable-gpu --no-first-run \
      --remote-debugging-port=9333 --user-data-dir=/tmp/cprof about:blank &

    node scripts/verify.mjs https://council.jonsaw567.workers.dev/selftest \
      "document.getElementById('tally').textContent.trim()"

`--dump-dom` is not enough here: it snapshots before the tool calls resolve.
