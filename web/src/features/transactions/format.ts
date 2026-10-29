import { describeCount } from "@gold/core";

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", {
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

/** "2 Jan 2026": a date with no time of day. */
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
