/**
 * The address of the Gilded server this computer talks to, e.g. https://gilded.example.com
 * People type it in various ways; we store one clean form (no trailing slash, no /api path).
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  // No scheme typed: https, except for this computer itself (the laptop demo), which has no certificate.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s))
    s = `${/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(s) ? "http" : "https"}://${s}`;
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

/** An address that only exists inside a building or on this computer. */
export const isPrivateHost = (h: string) =>
  h === "localhost" ||
  h === "127.0.0.1" ||
  /^10\./.test(h) ||
  /^192\.168\./.test(h) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
  h.endsWith(".local");

/**
 * For trying the app against a server on the branch network before it has a real certificate (a development certificate is not trusted by
 * anyone). Only ever true for a private address AND when it was switched on on purpose; a company server on the internet never qualifies.
 */
export function mayTrustSelfSigned(
  serverUrl: string | null,
  requestHost: string,
  switchedOn: boolean,
): boolean {
  if (!switchedOn || !serverUrl) return false;
  try {
    const u = new URL(serverUrl);
    return (
      u.protocol === "https:" &&
      isPrivateHost(u.hostname) &&
      u.hostname === requestHost
    );
  } catch {
    return false;
  }
}

/** Plain http is fine for a laptop demo or a server on the branch's own network, but it is not private across the internet. */
export function isInsecure(url: string): boolean {
  const u = new URL(url);
  if (u.protocol === "https:") return false;
  const h = u.hostname;
  return !isPrivateHost(h);
}
