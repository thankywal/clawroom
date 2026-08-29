# Demo video, three minutes

Rules: three minutes maximum, public on YouTube, narration explaining what was
built and how WebMCP is used, no third party trademarks.

Two browser windows side by side for the whole recording. Left is Mya, a
marketer. Right is the manager. Same room link, `?as=steward` on the right.

Record at 1440x900 or larger. Zoom the browser to about 125 percent so the log
is readable when it is half the frame.

---

## 0:00 to 0:20, the claim

**Screen.** The room, left window only, nothing happening yet. The tool strip
is visible along the top.

**Say.** "Everyone here is about to have an agent doing part of their job. The
person responsible for the team is about to lose sight of the work. Ban it and
people route around you. Watch them and they resent it. Git solved this shape
thirty years ago: a commit log shows what changed without showing how long you
sat there."

## 0:20 to 0:35, what a room is

**Screen.** Open the room switcher and change from Campaign to Classroom and
back. The tool chips visibly change.

**Say.** "ClawRoom is one engine and many rooms. A marketing department, a
classroom, a support desk, a shop floor. A room is a definition object, so
switching rooms changes what the agents in the room can actually do. Those tools
are registered with document.modelContext.registerTool, and since the API has no
unregisterTool, swapping them turns entirely on an AbortController."

## 0:35 to 1:20, the private half

**Screen.** Left window. Type: *"Draft two options for the launch announcement,
then submit the better one."* Let it run. Tool chips appear one at a time:
`list_posts`, `draft_post`, `draft_post`, `submit_for_review`.

**Say.** "This is the agent the site hosts, calling the page's own tools through
executeTool. Drafting is work tier, so both variants are sitting in this
browser's local storage. The room never receives them."

**Screen.** Point at the left panel: two private working files. Then at the work
log line: *drafted variant 2 of Launch announcement*.

**Say.** "What the room gets is that line. Not the draft."

## 1:20 to 1:50, the other side of the room

**Screen.** Move to the right window. The board already shows the submitted
post. Scroll the work log.

**Say.** "The manager's window, live over a Durable Object. She sees two
variants were written and one was submitted, and she can read the submitted one
because submitting is the moment a thing stops being yours. She cannot read the
one that was discarded, and there is no tool in this engine that would return
it."

## 1:50 to 2:20, the moment the room stops

**Screen.** Back to the left window. Type: *"Publish it."* The `publish` chip
appears in amber and says pending. The agent replies that it is waiting. The
board still says review.

**Say.** "Publish is commit tier. It did not publish. It returned a receipt with
a handle and the agent carried on, because holding a tool call open until a
human clicks would time out. WebMCP has no confirmation mechanism, so this is
our proposal for the gap."

**Screen.** Right window. The approval card is sitting there. Click Approve.
Cut to the left window: the board flips to done.

**Say.** "Only a person can click that. The manager's agent can read the queue
and argue for it, but there is no approve tool anywhere in this engine."

## 2:20 to 2:40, the signal that pays for it

**Screen.** Switch to the Support desk room. Run diagnostics on two or three
tickets so the signal fires, then show the banner.

**Say.** "Four agents ran the same diagnostic and it failed every time. That is
one product bug, not four support tickets, and nobody sees it today because
each of those conversations happens in a different window."

## 2:40 to 3:00, the proof

**Screen.** Open `/selftest`. Show 10 of 10, and point at the two rows named for
the claim rather than the function.

**Say.** "Every tool, called through executeTool with no agent, in a clean
browser with no flags. Two of these test the claim instead of the code. One
writes a sentence into a private draft and then searches all of shared state for
it. The other publishes, checks nothing moved, approves as a human, and only
then expects the effect. Everyone brings an agent. The room sees the work, not
the people."

---

## Before recording

- Fresh room key in the URL so the board starts clean.
- Clear localStorage in both windows, so the private panel starts at zero.
- Run through once without recording. The agent takes a few seconds per turn
  and you want to know where the pauses land.
- Have `/selftest` already loaded in a third tab so the ending is instant.
- If Workers AI has burned through its daily free allowance, the agent will say
  so plainly. Check it before you start.
