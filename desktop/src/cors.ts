/**
 * The desktop window loads the app from app://gilded and talks to the company's server on another address. Browsers refuse that unless the
 * server agrees, and the refresh cookie is not sent across sites unless it is SameSite=None. Rather than loosen the server for everybody,
 * this app (and only this app, and only for calls to the one server it is set up for) adjusts the answers it receives.
 */
export const APP_ORIGIN = "app://gilded";

type Headers = Record<string, string[]>;

const lower = (h: Headers, name: string) =>
  Object.keys(h).filter((k) => k.toLowerCase() === name.toLowerCase());

export function rewriteSetCookie(value: string): string {
  const parts = value
    .split(";")
    .map((p) => p.trim())
    .filter((p) => !/^samesite=/i.test(p) && !/^secure$/i.test(p));
  return [...parts, "SameSite=None", "Secure"].join("; ");
}

export function adjustResponseHeaders(
  headers: Headers,
  method: string,
  requestHeaders: Record<string, string> = {},
): { headers: Headers; statusLine?: string } {
  const out: Headers = { ...headers };
  for (const k of [
    ...lower(out, "access-control-allow-origin"),
    ...lower(out, "access-control-allow-credentials"),
    ...lower(out, "access-control-allow-headers"),
    ...lower(out, "access-control-allow-methods"),
  ])
    delete out[k];
  out["Access-Control-Allow-Origin"] = [APP_ORIGIN];
  out["Access-Control-Allow-Credentials"] = ["true"];
  out["Access-Control-Expose-Headers"] = ["Date"];
  out["Vary"] = ["Origin"];
  for (const k of lower(out, "set-cookie"))
    out[k] = out[k]!.map(rewriteSetCookie);
  if (method.toUpperCase() === "OPTIONS") {
    const asked = Object.entries(requestHeaders).find(
      ([k]) => k.toLowerCase() === "access-control-request-headers",
    )?.[1];
    out["Access-Control-Allow-Methods"] = [
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    ];
    out["Access-Control-Allow-Headers"] = [
      asked ??
        "Content-Type, Authorization, Idempotency-Key, X-Client-Time, X-Client-Version",
    ];
    out["Access-Control-Max-Age"] = ["600"];
    return { headers: out, statusLine: "HTTP/1.1 204 No Content" };
  }
  return { headers: out };
}
