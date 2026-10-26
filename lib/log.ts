type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

// status_token matches on purpose: it authorizes fund release (ARCHITECTURE §5.6).
const REDACT = /secret|password|authorization|token|api_?key|assertion/i;

function serialize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => serialize(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      REDACT.test(key) ? "[redacted]" : serialize(item, depth + 1),
    ]),
  );
}

function write(level: Level, msg: string, fields?: Fields) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(serialize(fields ?? {}) as Fields),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Fields) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),

  /** PayPal support asks for `debug_id`, so every failed PayPal call logs it. */
  paypalError: (operation: string, response: { status: number; headers?: Headers }, body: unknown) =>
    write("error", `paypal ${operation} failed`, { operation, ...paypalErrorFields(response, body) }),
};

export function paypalErrorFields(response: { status: number; headers?: Headers }, body: unknown) {
  const err = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    http_status: response.status,
    // The OAuth token endpoint returns `error`/`error_description` instead of `name`/`message`.
    name: str(err.name) ?? str(err.error),
    debug_id: str(err.debug_id) ?? response.headers?.get("paypal-debug-id") ?? undefined,
    message: str(err.message) ?? str(err.error_description),
    details: Array.isArray(err.details) ? err.details : undefined,
  };
}
