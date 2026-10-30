import type { McpErrorCode } from "@/lib/schemas/mcp";

/** A rule refused the request. `code` is the stable MCP error code agents see (ARCHITECTURE §7.1). */
export class PolicyError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}
