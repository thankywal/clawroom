# The demo film

Two minutes twenty. Built rather than filmed by hand, so it can be rebuilt when
something changes.

The pipeline lives beside this repo in `../clawroom-video` and is kept out of
here on purpose: this repo is the product, and the rules ask for the source
required to make the product work, not the source required to make its trailer.

## How it is made

Six of the eight segments are the deployed product, driven over the Chrome
DevTools Protocol against the live origin. Nothing in them is a reconstruction.
The agent thinking is the agent thinking, and the address bar in the footage is
part of the proof.

The capture is change driven: a frame is written when the page repaints, and
each one carries the moment it did. Playback holds the last frame in between,
so a four second pause while a model works reads as four seconds rather than a
cut.

The other two segments are rendered title cards.

Narration is Chirp3 HD. There is no music: the film is somebody explaining a
thing they built, and a bed underneath was telling the viewer how to feel about
it. Generating the voice rather than recording one also meant the script could
still be edited on the last day, because re-recording costs forty seconds.

Every segment is exactly as long as the voice measured. The picture is cut to
`audio/vo/timing.json` and nothing is nudged by hand.

## The cut

Every segment is as long as its narration measured, so the table is the
narration's timing file rendered as prose.

| Segment | Length | On screen |
|---|---|---|
| what | 5.5s | title card |
| make | 9.2s | the lobby, a room being made |
| crowd | 13.1s | three people, three agents, one log |
| private | 11.3s | work tier staying in one browser |
| computer | 15.1s | the agent writes a script, runs it, shares it by choice |
| console | 14.7s | the person types into the same machine; the manager sees counts |
| commit | 15.3s | publish parks, nothing ships |
| approve | 9.9s | a person reading the words, then clicking |
| theirs | 12.9s | a real Codex run, parked, read out of the room it happened in |
| borrowed | 17.9s | an approval that adds four tools to every browser at once |
| signal | 14.0s | four diagnostics, one product bug |
| honest | 7.9s | title card, what we found |
| close | 15.7s | the self test, then the mark |

The `theirs` segment is the only capture in the film the film did not cause. The room already held a real Codex run, made from a person's own terminal through the MCP bridge; the scene opens the manager's window and reads what was waiting there. `public/scenes/theirs-room.json` is the room it reads.

The borrowed segment is two cuts of one capture, because the thing it shows
happens in a quarter of a second: the ask held on the approval card, then the
surface it produced, held on the chip row. The capture was pruned to its first
four seconds afterwards, since the rest was a static hold and a gigabyte of
identical frames.

The console segment is three cuts of one capture. The typing plays at speed,
the output is held from the moment the machine answered (the wait in between
was the sandbox waking, which shows nothing), and the manager's page is shown
from the moment its table had rendered. Dan's three failures were made off
camera through the same `computer_run` tool, which is the only way anything
reaches the log.

## The one timing bug worth remembering

Cutting a narration line out of the closing segment left the end card five
seconds behind its own sentence, so the film said "everyone brings an agent"
over a screenshot of a test log, and then flashed the card for a second and
stopped. The card is now positioned by reading the narration timing file for
the line it belongs to, rather than by a number typed into the composition, so
the next cut cannot do it again.

## Before uploading

- Unlisted on YouTube, not private. Private cannot be opened by a judge.
- Check the audio landed at -14 LUFS, which is what YouTube normalises to.
- Watch it once at full size and read every line of small text. The film is
  mostly small text and the whole point is that it can be read.

## What this process caught

Filming the real product found a real bug. A support desk was mounting the
marketing team's tools, because the page mounts a surface before the server has
said what the room is, and it only remounted when the role turned out different
rather than when the definition did. Fixed in `src/ui/room.ts`. Reading the
code would not have found it.
