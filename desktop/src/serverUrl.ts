/**
 * The address of the Gilded server this computer talks to, e.g. https://gilded.example.com
 * People type it in various ways; we store one clean form (no trailing slash, no /api path).
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname) return null;
  return u.origin;
}

/** Plain http is fine for a laptop demo or a server on the branch's own network, but it is not private across the internet. */
export function isInsecure(url: string): boolean {
  const u = new URL(url);
  if (u.protocol === "https:") return false;
  const h = u.hostname;
  return !(
    h === "localhost" ||
    h === "127.0.0.1" ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith(".local")
  );
}
