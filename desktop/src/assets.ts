import path from "node:path";

/**
 * Maps an app://gilded/... address to a file inside the bundled web build.
 * - never leaves the build folder (no ../ tricks)
 * - an address without a file extension is a screen of the app, so it gets index.html (page refresh / deep links work)
 */
export function resolveAsset(root: string, urlPath: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  } catch {
    return null;
  }
  if (p.includes("\0")) return null;
  const rel = p.replace(/^\/+/, "");
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  if (rel === "" || !path.extname(rel)) return path.join(base, "index.html");
  return full;
}
