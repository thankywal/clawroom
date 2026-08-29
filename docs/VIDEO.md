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

| Segment | Length | On screen |
|---|---|---|
| what | 16.3s | title card |
| make | 9.2s | the lobby, a room being made |
| crowd | 20.5s | three people, three agents, one log |
| private | 11.0s | work tier staying in one browser |
| commit | 23.7s | publish parks, nothing ships |
| approve | 8.3s | a person clicking it |
| signal | 14.0s | four diagnostics, one product bug |
| honest | 17.2s | title card, what we found |
| close | 16.8s | the self test, ten of ten |

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
