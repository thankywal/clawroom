# Writing a room

A room is one file. There is no new component, no engine change, and no branch
in the UI. If a room ever seems to need its own screen, that is the schema
being wrong rather than the room being special.

Look at `src/rooms/support.ts` first. It is the shortest one and it carries the
signal that best explains why any of this exists.

## The shape

```ts
export const support: RoomDefinition = {
  id: 'support',
  title: 'Tuesday support desk',
  premise: 'A support team working tickets, each person with their own agent.',
  stewardRole: 'support lead',
  memberRole: 'support rep',
  memberTools: [ ... ],
  stewardTools: [],      // the builtins are usually enough
  signals: [ ... ],
  seed: (people) => [ ... ],
}
```

Then add it to `src/rooms/index.ts`. That is the whole job.

## Picking a tier

The tier is not a permission level, it is a statement about where the payload
lives. Choosing it correctly is most of the work of writing a room.

**work** is for anything a person would consider theirs. Running a diagnostic,
drafting copy, asking for a hint, checking an answer before committing to it.
The payload goes in `ctx.scratch`, which is localStorage for that member in that
room, and the room only ever learns the one line you put in `summary`. Calling
`ctx.put` from a work-tier tool throws, deliberately.

**share** is the moment something becomes everyone's. Submitting a draft,
replying to a customer, putting an answer on the board. Use `ctx.put` to write
the work item.

**commit** is for anything a person should have to agree to. Publishing,
refunding, discounting, granting an extension. The engine calls your `run`
twice: once with `ctx.approved === false`, where you return a short description
of what you would do and change nothing, and again in the approver's browser
with `ctx.approved === true`, where you actually do it. That is why `Approval`
carries its arguments, and why commit-tier arguments are public by
construction.

## Writing descriptions

Tool descriptions are the only place an agent learns the rules of your room, so
write them for the agent rather than for a docs page. Two habits help.

Say where the payload goes. "The hint text stays on this machine. Your teacher
learns that you asked, not what you were told." An agent that knows this stops
apologising for privacy it has not broken.

Keep input schemas flat. No nested objects, no `oneOf`. Models in the 70B range
get noticeably worse at tool calling the moment a schema has depth, and every
tool here is small enough not to need it.

You do not need to mention approvals. The engine appends the commit-tier note
to your description at registration time, so no room author can forget it.

## Signals

A signal reads the same event log everyone in the room can see, which means it
can never surface something the steward was not already entitled to know. That
property is worth preserving.

The good ones are about the shape of the work rather than the volume of it:

```ts
// four agents failing the same diagnostic is one product bug, not four tickets
detect: (events) => { ... }
```

`distinctCallers` and `callCount` in `src/engine/signals.ts` cover most cases.

## Reading the body

`WorkItem.body` is `Record<string, unknown>`, so with `noUncheckedIndexedAccess`
on, every field access is `unknown`. Do one contained cast per room file rather
than a cast per access:

```ts
interface TicketBody { customer: string; problem: string; reply: string }
const body = (i: WorkItem) => i.body as unknown as TicketBody
```
