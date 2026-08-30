// A room is a schema. Everything that makes a marketing department different
// from a classroom lives in one of these objects: who the steward is, what
// tools the members' agents get, what counts as work, and which call patterns
// the steward should be told about.
//
// The engine does not know what a campaign or a homework problem is. It knows
// members, tools, work items and events.

export type Tier = 'work' | 'share' | 'commit'

export type MemberId = string
export type ItemId = string

export interface Person {
  id: MemberId
  name: string
  colour: string
}

/** What one participant's agent may do, and what it costs to do it. */
export interface RoomTool {
  name: string
  /** What a person should see in a tool picker. Falls back to the name,
   *  prettified, so no tool ever shows up as bare snake_case. */
  title?: string
  /** Written for the agent. This is the only place it learns the room's rules. */
  description: string
  tier: Tier
  inputSchema: Record<string, unknown>
  /** True for tools that only read. Maps straight onto WebMCP's readOnlyHint. */
  readOnly?: boolean
  /** True when the tool returns text a member typed. The steward's agent should
   *  treat that as untrusted content, and WebMCP has a hint for exactly this. */
  untrusted?: boolean
  /** May be async. A tool that talks to the member's own computer has to be. */
  run: (ctx: ToolContext, args: Record<string, any>) => ToolOutcome | Promise<ToolOutcome>
}

export interface ToolOutcome {
  /** Shown to the calling agent. */
  text: string
  /** Machine readable half of the same answer. */
  data?: unknown
  /** One line for the room log. Never the conversation, only what happened. */
  summary?: string
  /** Set by commit-tier tools that are waiting on a human. */
  pending?: boolean
}

export interface ToolContext {
  room: RoomState
  me: Person
  /** Steward tools see the whole room; member tools see their own work. */
  isSteward: boolean
  /**
   * True only on the replay pass, after a human approved a commit-tier call.
   * A commit tool is called twice: once to describe what it would do, and
   * again, in the approver's browser, to actually do it.
   */
  approved: boolean
  /**
   * The only legal way to change shared state. The engine hands work-tier
   * tools, and the unapproved pass of commit-tier tools, a version that
   * throws. The tier rule is therefore enforced by construction rather than
   * by asking room authors to remember it.
   */
  put: (item: WorkItem) => void
  /** Per member, per room, this browser only. Never synced, never logged. */
  scratch: Scratch
}

/** Where work-tier tools keep their payload. localStorage under the hood. */
export interface Scratch {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  keys: () => string[]
}

/** The unit of work. A post, a homework problem, a support ticket, an order. */
export interface WorkItem {
  id: ItemId
  title: string
  state: 'open' | 'drafting' | 'review' | 'blocked' | 'done'
  owner?: MemberId
  /** Room-specific payload. The engine passes it through untouched. */
  body: Record<string, unknown>
}

/**
 * The commit log. One entry per tool call or human action, and nothing else.
 * This is the whole privacy position: the steward reads this, never the
 * conversation that produced it.
 */
export interface Event {
  at: number
  actor: MemberId
  kind: 'agent' | 'human'
  tool: string
  tier: Tier
  item?: ItemId
  summary: string
}

/** A signal that has actually fired, ready to show. */
export interface FiredSignal {
  id: string
  label: string
  text: string
}

/** A pattern over the log that the steward should be shown. */
export interface Signal {
  id: string
  label: string
  /** Returns a human sentence when the pattern fires, otherwise null. */
  detect: (events: Event[], room: RoomState) => string | null
}

/** A commit-tier call parked until a human decides. */
export interface Approval {
  id: string
  requestedBy: MemberId
  tool: string
  item?: ItemId
  describe: string
  at: number
  /**
   * Replayed into the tool when a human approves. Note what this implies:
   * commit-tier arguments are public by construction, because approval
   * happens in someone else's browser. That is the right semantics anyway,
   * since committing is the act of making something public.
   */
  args: Record<string, unknown>
}

export interface RoomDefinition {
  id: string
  title: string
  /** One line the landing page and the steward board both use. */
  premise: string
  stewardRole: string
  memberRole: string
  stewardTools: RoomTool[]
  memberTools: RoomTool[]
  signals: Signal[]
  /** Starting work items, so a visitor lands in a room that already has a life. */
  seed: (people: Person[]) => WorkItem[]
}

export interface RoomState {
  def: RoomDefinition
  steward: Person
  members: Person[]
  items: WorkItem[]
  events: Event[]
  approvals: Approval[]
  /** Tools this room borrowed from somewhere else, after a person said yes. */
  sources: ToolSource[]
}

/**
 * A place a room got extra tools from: an OpenAPI document, a remote MCP
 * server, or a page that registers its own WebMCP tools.
 *
 * A source is public by construction. It lives in shared state, everybody in
 * the room gets the tools it carries, and only the steward can put one there.
 * A member's agent can propose one, which parks like any other commit.
 */
export interface ToolSource {
  id: string
  kind: 'openapi' | 'mcp' | 'webmcp'
  name: string
  /** Where the description came from. */
  url: string
  /** Where the calls go. */
  base: string
  addedBy: MemberId
  at: number
  tools: SourceTool[]
  /** Set when the tools cannot be called from here, and says why. */
  note?: string
}

/** One borrowed tool. Same shape as a room tool, plus how to reach it. */
export interface SourceTool {
  name: string
  description: string
  tier: Tier
  inputSchema: Record<string, unknown>
  /** openapi: the verb and path template. mcp: the remote tool name. */
  method?: string
  path?: string
  remote?: string
}
