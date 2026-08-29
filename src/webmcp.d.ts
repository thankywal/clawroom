// Ambient types for the WebMCP browser API. Chrome exposes this on `document`;
// some builds also mirror it on `navigator`, so both are declared and the app
// resolves whichever is present at startup.
//
// Measured against Chrome 151 with the origin trial token. See
// docs/WEBMCP-NOTES.md for what is actually implemented today; notably there is
// no unregisterTool(), so removal goes through an AbortSignal.

export interface ToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

export interface ToolContent {
  type: 'text'
  text: string
}

export interface ToolResult {
  content: ToolContent[]
  structuredContent?: unknown
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: ToolAnnotations
  execute: (args: any, ctx?: { signal?: AbortSignal }) => Promise<ToolResult | string>
}

export interface RegisterOptions {
  signal?: AbortSignal
  exposedTo?: string[]
}

export interface RegisteredTool {
  name: string
  description: string
}

export interface ModelContext {
  registerTool(def: ToolDefinition, opts?: RegisterOptions): Promise<void>
  getTools(opts?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>
  // Resolves to the result envelope serialised as JSON, not as an object.
  executeTool(tool: RegisteredTool, argsJson: string): Promise<string | ToolResult>
}

declare global {
  interface Document { modelContext?: ModelContext }
  interface Navigator { modelContext?: ModelContext }
}
