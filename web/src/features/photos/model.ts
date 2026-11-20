/** Pure rules for photos (no browser needed, so they are unit-tested). */
export const MAX_EDGE = 1600;
export const THUMB_EDGE = 320;
export const JPEG_QUALITY = 0.82;

export type PhotoSource = "camera" | "native" | "library" | "paste";
export type PhotoStatus = "queued" | "sending" | "sent" | "failed";

/** What a picture belongs to once it is sent ('personal' = My pictures, private to the person; its entityId is the person's own id). A picture with no target (the lab) is only kept on the device. */
export interface PhotoTarget {
  entityType:
    | "transfer"
    | "user"
    | "day"
    | "collateral"
    | "transaction"
    | "customer"
    | "personal"
    | "gsentry";
  entityId: string;
  slot:
    | "release"
    | "receive"
    | "other"
    | "profile"
    | "closing"
    | "opening"
    | "collateral"
    | "goods"
    | "id"
    | "receipt";
}

export interface PhotoRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Bytes of the compressed picture that is sent. */
  size: number;
  /** Bytes of the picture as it came from the camera or the library. */
  originalSize: number;
  sha256: string;
  /** Fingerprint of the file the picture was made from, so the same picture used on two records can be noticed. */
  originalSha256?: string;
  source: PhotoSource;
  /** When it was taken: now for the camera, the file's own date for the library. */
  takenAt: string;
  stamped: boolean;
  /** Milliseconds the device spent shrinking it. */
  prepMs: number;
  status: PhotoStatus;
  /** 0 to 1 while sending. */
  progress: number;
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  createdAt: number;
  target?: PhotoTarget;
  /** The person who took it. A picture waits if somebody else is signed in on the device, and goes when its owner is back. */
  owner?: string;
}

/** Shrink to fit inside `max` on the longer side, never enlarging. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0) return { width: 0, height: 0 };
  const s = Math.min(1, max / longest);
  return {
    width: Math.max(1, Math.round(width * s)),
    height: Math.max(1, Math.round(height * s)),
  };
}

export interface StampInfo {
  branch: string;
  reference?: string;
  person: string;
  at: Date;
}

/** The two lines burned into a picture: where and what, then when and who. Weekday included. */
export function stampLines(i: StampInfo): [string, string] {
  const when = i.at
    .toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/,/g, "");
  return [
    [i.branch, i.reference].filter(Boolean).join(" · "),
    `${when} · ${i.person}`,
  ];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Wait before the next try: 2 s, 4 s, 8 s … never more than 60 s. */
export const backoffMs = (attempts: number) =>
  Math.min(60_000, 1000 * 2 ** Math.min(Math.max(attempts, 1), 6));

/** After this many tries a picture is parked as failed for a person to retry. */
export const MAX_ATTEMPTS = 8;

export interface QueueSummary {
  waiting: number;
  sending: number;
  sent: number;
  failed: number;
  text: string;
}
export function summarize(
  rs: readonly Pick<PhotoRecord, "status" | "progress">[],
): QueueSummary {
  const s = { waiting: 0, sending: 0, sent: 0, failed: 0 };
  for (const r of rs) {
    if (r.status === "queued") s.waiting++;
    else if (r.status === "sending") s.sending++;
    else if (r.status === "sent") s.sent++;
    else s.failed++;
  }
  const parts: string[] = [];
  if (s.sending) parts.push(`${s.sending} sending`);
  if (s.waiting) parts.push(`${s.waiting} waiting to send`);
  if (s.failed) parts.push(`${s.failed} could not be sent`);
  if (!parts.length && s.sent) parts.push(`${s.sent} sent`);
  return { ...s, text: parts.join(" · ") || "No photos yet" };
}

/** Does this look like something we can read as a picture? (HEIC from some library picks is converted by the phone; if not, we say so.) */
export function isPictureFile(f: { type: string; name: string }): boolean {
  return (
    /^image\//.test(f.type) ||
    /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name)
  );
}
