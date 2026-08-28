# Council · WebMCP tool surface

Two zones. The boundary between them is the product.

    ┌──────────────── COUNCIL PAGE ────────────────┐
    │                                              │
    │  PRIVATE ZONE              PUBLIC ZONE       │
    │  localStorage              synced to all     │
    │  never leaves browser      every participant │
    │                                              │
    │  remember_my_constraints   list_options      │
    │  get_my_constraints        get_option        │
    │  check_fit          ──►    propose           │
    │  relax_constraint          reject            │
    │                            get_council_state │
    └──────────────────────────────────────────────┘

`check_fit` is the hinge: it runs **in the participant's browser**, over data that
never syncs, and emits only a verdict. The reason a thing does not fit is never
serialised, anywhere.

---

## Private zone — local only, never synced

### `remember_my_constraints`
`annotations: { readOnlyHint: false }` — writes local state only.

    {
      hard: [ { id, type: "blockDate" | "maxTotal" | "excludeTag", value } ],
      soft: [ { id, type: "prefer" | "avoid", value, weight: 0..1 } ]
    }

Returns a count only. Never echoes values back into anything shared.

### `get_my_constraints`
`readOnlyHint: true`. Returns the caller's own constraints so the agent can
re-read them in a later turn without asking its human again.

### `check_fit`
`readOnlyHint: true`. **The core local computation.**

    in:  { optionId }
    out: {
           feasible: boolean,          // all hard constraints satisfied
           score: 0..1,                // weighted soft-preference match
           blockers: [ constraintId ], // ids only — never the values
           concessions: [              // what would have to give
             { constraintId, wouldFitIf: { … } }
           ]
         }

`blockers` returns **ids**, not descriptions. `score` reveals a number with no
attached reason. This is what makes trade-offs possible without disclosure.

### `relax_constraint`
Called only after the human approves a concession in the page UI.
Rewrites one local constraint, then the agent re-runs `check_fit`.

---

## Public zone — synced to every participant

### `list_options` / `get_option`
`readOnlyHint: true`. The **page owns the catalog** — seeded, deterministic, no
external search. The agent's job is to decide and negotiate, not to discover.

### `propose`
    in: { optionId, note? }        // note is public, optional, human-authored
Records this participant as accepting the option.

### `reject`
    in: { optionId, publicReason } // free text, deliberately vague
Records a rejection. `publicReason` is written by the agent from its private
reasoning; the reasoning itself stays local.

### `get_council_state`
`readOnlyHint: true`. Options, per-participant verdicts, open concession
requests, and whether consensus has been reached.

---

## Deadlock resolution uses only public information

When no option has full acceptance the page finds the options with the fewest
blockers and raises a concession request against that participant. It can do
this because "who rejected what" is public while "why" is not.

The request surfaces **in that participant's UI, not to their agent** — the
decision belongs to the human. On approval, their agent calls
`relax_constraint` locally and re-enters the round.

---

## Turn-based reality

Browser agents act when their human prompts them; they do not run in the
background. Council is designed around that rather than against it: each agent
performs a **round** — read state, check new options, propose or reject, report
back — and then hands control to its human. Humans veto, relax, or say
continue. That alternation is the collaboration, not a limitation of it.

Seeded demo participants run automatically in the visitor's own browser, each
with an isolated private store, so a single judge can convene a full Council.
