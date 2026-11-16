import { describe, expect, it } from "vitest";
import { uploadMeta } from "@/features/photos/api";
import type { PhotoRecord } from "@/features/photos/model";
import {
  namesText,
  nearlyFull,
  personalListSchema,
  sharedListSchema,
  usageText,
} from "./api";

const rec = (target: PhotoRecord["target"]): PhotoRecord => ({
  id: "a",
  name: "x.jpg",
  width: 900,
  height: 1200,
  size: 1,
  originalSize: 2,
  sha256: "h",
  originalSha256: "o",
  source: "camera",
  takenAt: "2026-11-15T10:00:00Z",
  stamped: true,
  prepMs: 1,
  status: "queued",
  progress: 0,
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 0,
  target,
});

describe("My pictures", () => {
  it("sends only the facts of the picture itself, with no record to attach to and no evidence fields", () => {
    const m = uploadMeta(
      rec({ entityType: "personal", entityId: "u1", slot: "other" }),
    );
    expect(m).toEqual({
      id: "a",
      fileName: "x.jpg",
      width: 900,
      height: 1200,
      takenAt: "2026-11-15T10:00:00Z",
    });
    expect(m).not.toHaveProperty("entityType");
    expect(m).not.toHaveProperty("originalSha");
  });

  it("still sends company pictures with their record and fingerprint", () => {
    const m = uploadMeta(
      rec({ entityType: "transfer", entityId: "t1", slot: "release" }),
    );
    expect(m).toMatchObject({
      entityType: "transfer",
      entityId: "t1",
      slot: "release",
      originalSha: "o",
      source: "camera",
      stamped: true,
    });
  });

  it("reads the server list and says how much is used", () => {
    const list = personalListSchema.parse({
      items: [
        {
          id: "p",
          caption: null,
          fileName: "a.jpg",
          size: 500000,
          width: 1,
          height: 1,
          takenAt: "2026-11-15T10:00:00Z",
          createdAt: "2026-11-15T10:00:01Z",
        },
      ],
      total: 1,
      page: 1,
      size: 60,
      usage: {
        enabled: true,
        count: 12,
        bytes: 5.4 * 1024 * 1024,
        maxCount: 300,
        maxMb: 300,
      },
    });
    expect(usageText(list.usage)).toBe("12 of 300 pictures · 5.4 of 300 MB");
    expect(nearlyFull(list.usage)).toBe(false);
    expect(nearlyFull({ ...list.usage, count: 280 })).toBe(true);
  });

  it("says who a picture is shared with in a short phrase", () => {
    const p = (n: string) => ({ id: n, displayName: n });
    expect(namesText([p("Kojo")])).toBe("Kojo");
    expect(namesText([p("Kojo"), p("Ama")])).toBe("Kojo and Ama");
    expect(namesText([p("Kojo"), p("Ama"), p("Yaw")])).toBe(
      "Kojo, Ama and 1 other",
    );
    expect(namesText([p("Kojo"), p("Ama"), p("Yaw"), p("Efua")])).toBe(
      "Kojo, Ama and 2 others",
    );
  });

  it("reads the pictures shared with the person, with who shared them", () => {
    const l = sharedListSchema.parse({
      items: [
        {
          id: "p",
          caption: "price board",
          size: 1,
          takenAt: "2026-11-15T10:00:00Z",
          createdAt: "2026-11-15T10:00:01Z",
          sharedBy: { id: "u", displayName: "Ama" },
          sharedAt: "2026-11-16T09:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      size: 60,
    });
    expect(l.items[0]?.sharedBy.displayName).toBe("Ama");
  });
});
