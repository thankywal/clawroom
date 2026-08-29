// What the room does when the model's daily allowance is gone.
//
// Workers AI on the free plan errors rather than charging when the day's
// Neurons are spent, which is the behaviour we want and the wrong thing to
// show a visitor. A judge who arrives on the wrong afternoon would otherwise
// meet an apology where the product should be.
//
// So the fallback replays a fixed sequence of tool calls. Every call is real:
// it goes through document.modelContext.executeTool, lands in the engine's
// log, syncs to everyone else in the room, and a commit-tier call really does
// park for a human. The only thing that is canned is the choice of calls.
//
// That distinction is the whole reason this is acceptable, so the room says it
// out loud rather than letting a rehearsal pass for a model deciding.

export interface RehearsedCall {
  name: string
  args: Record<string, unknown>
}

const PLANS: Record<string, RehearsedCall[]> = {
  campaign: [
    { name: 'list_posts', args: {} },
    { name: 'draft_post', args: { itemId: 'post_1', headline: 'Everything you already had, now cheaper', copy: 'The Q3 release lands today, and the price goes down with it.' } },
    { name: 'draft_post', args: { itemId: 'post_1', headline: 'A smaller bill, the same product', copy: 'Same product, new pricing. Here is what changes for you.' } },
    { name: 'revise', args: { itemId: 'post_1', headline: 'A smaller bill, the same product', copy: 'Same product, new pricing, and nothing you rely on moves.' } },
    { name: 'submit_for_review', args: { itemId: 'post_1' } },
    { name: 'publish', args: { itemId: 'post_1' } },
  ],
  classroom: [
    { name: 'get_problem', args: { itemId: 'q1' } },
    { name: 'request_hint', args: { itemId: 'q1' } },
    { name: 'check_answer', args: { itemId: 'q1', answer: '4' } },
    { name: 'submit', args: { itemId: 'q1', answer: '4' } },
    { name: 'request_extension', args: { itemId: 'q3' } },
  ],
  support: [
    { name: 'get_tickets', args: {} },
    { name: 'run_diagnostic', args: { itemId: 't_401' } },
    { name: 'reply_to_customer', args: { itemId: 't_401', reply: 'The morning export timeout is reproducible on our side. Engineering has it.' } },
    { name: 'issue_refund', args: { itemId: 't_403' } },
  ],
  shop: [
    { name: 'list_requests', args: {} },
    { name: 'check_stock', args: { itemId: 'c_1' } },
    { name: 'reserve', args: { itemId: 'c_1', picked: 'oat milk, rye flour' } },
    { name: 'apply_discount', args: { itemId: 'c_3' } },
  ],
}

export function rehearsedPlan(defId: string): RehearsedCall[] {
  return PLANS[defId] ?? []
}

export const REHEARSAL_NOTE =
  "The model's free allowance for today is spent, so what follows is rehearsed " +
  'rather than decided. The tool calls below are real and go through ' +
  'executeTool, the log and the approval are real. Only the choice of calls is ' +
  'scripted. The room itself still works normally without any agent at all.'
