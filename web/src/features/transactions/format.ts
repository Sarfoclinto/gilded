import { describeCount } from "@gold/core";

/** "Mon 02 Nov, 14:05": a moment, with the weekday so a glance tells a Saturday from a Monday (B58). */
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "1 pack, 6 bundles, 88 loose" for a count of notes. */
export function packText(notes: number): string {
  const d = describeCount(notes);
  return (
    [
      d.packs ? `${d.packs} pack${d.packs > 1 ? "s" : ""}` : null,
      d.bundles ? `${d.bundles} bundle${d.bundles > 1 ? "s" : ""}` : null,
      d.loose ? `${d.loose} loose` : null,
    ]
      .filter(Boolean)
      .join(", ") || "—"
  );
}

/** "Fri 2 Jan 2026": a date with no time of day. */
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** "just now", "5 min ago", "2 h ago", then the time of day. For a list that people watch fill up. */
export function recently(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 360) return `${Math.floor(mins / 60)} h ago`;
  return when(iso);
}
