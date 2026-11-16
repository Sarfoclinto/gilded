import axios from "axios";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/features/auth/store";
import { http, request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { NetworkError, type Sender } from "./queue";
import type { PhotoRecord, PhotoTarget } from "./model";

export const photoKeys = createKeys("photos");

const personSchema = z
  .object({ id: z.string(), displayName: z.string() })
  .nullable()
  .optional();

/** One stored picture, as the server describes it. */
export const attachmentSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  slot: z.string(),
  fileName: z.string(),
  size: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  takenAt: z.string(),
  source: z.string().nullable().optional(),
  stamped: z.boolean(),
  /** An earlier picture on another record came from the same file. */
  reused: z.boolean().optional(),
  uploadedAt: z.string(),
  by: personSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** One picture in the library: the stored facts plus what it belongs to. */
export const libraryItemSchema = attachmentSchema.extend({
  label: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  branchName: z.string().nullable().optional(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;
export const librarySchema = z.object({
  items: z.array(libraryItemSchema),
  total: z.number(),
  page: z.number(),
  size: z.number(),
});
export interface LibraryFilters {
  branchId?: string;
  type?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  size?: number;
}

export const gapSchema = z.object({
  kind: z.string(),
  id: z.string(),
  label: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  branchName: z.string().nullable().optional(),
  at: z.string(),
  missing: z.string(),
});
export type Gap = z.infer<typeof gapSchema>;

export const photosApi = {
  gaps: (signal?: AbortSignal) =>
    request(
      { method: "get", url: "/attachments/gaps", signal },
      z.array(gapSchema),
    ),
  library: (f: LibraryFilters, signal?: AbortSignal) =>
    request(
      {
        method: "get",
        url: "/attachments/library",
        params: Object.fromEntries(
          Object.entries(f).filter(([, v]) => v !== undefined && v !== ""),
        ),
        signal,
      },
      librarySchema,
    ),
  list: (entityType: string, entityId: string, signal?: AbortSignal) =>
    request(
      {
        method: "get",
        url: "/attachments",
        params: { entityType, entityId },
        signal,
      },
      z.array(attachmentSchema),
    ),
  remove: (id: string, reason?: string) =>
    request(
      {
        method: "post",
        url: `/attachments/${id}/remove`,
        data: { reason: reason ?? null },
      },
      z.object({ id: z.string(), removed: z.boolean() }),
    ),
};

export function useGaps(enabled: boolean) {
  return useApiQuery({
    queryKey: photoKeys.custom("gaps", {}),
    queryFn: ({ signal }) => photosApi.gaps(signal),
    enabled,
    staleTime: 20_000,
  });
}

export function useLibrary(f: LibraryFilters) {
  return useApiQuery({
    queryKey: photoKeys.custom("library", { ...f }),
    queryFn: ({ signal }) => photosApi.library(f, signal),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

export function useAttachments(
  entityType: string,
  entityId: string | undefined,
) {
  return useApiQuery({
    queryKey: photoKeys.custom("of", { entityType, entityId }),
    queryFn: ({ signal }) =>
      photosApi.list(entityType, entityId as string, signal),
    enabled: !!entityId,
    staleTime: 30_000,
  });
}

export function useRemoveAttachment() {
  return useApiMutation<
    { id: string; removed: boolean },
    { id: string; reason?: string }
  >({
    mutationFn: ({ id, reason }) => photosApi.remove(id, reason),
    invalidates: [photoKeys.all, ["transfers"], ["profile-photo"]],
    successMessage: "Photo removed",
  });
}

/** The facts sent with a picture. My pictures are private to the person, so they carry no record to attach to and no evidence fields. */
export function uploadMeta(record: PhotoRecord): Record<string, unknown> {
  const t = record.target;
  if (t?.entityType === "personal")
    return {
      id: record.id,
      fileName: record.name,
      width: record.width,
      height: record.height,
      takenAt: record.takenAt,
    };
  return {
    id: record.id,
    originalSha: record.originalSha256,
    entityType: t?.entityType,
    entityId: t?.entityId,
    slot: t?.slot,
    fileName: record.name,
    width: record.width,
    height: record.height,
    takenAt: record.takenAt,
    source: record.source === "paste" ? "library" : record.source,
    stamped: record.stamped,
  };
}

/** The real sender: one request with the picture, its preview and the facts. Safe to repeat: the server keeps one per picture id. */
export const sendPhoto: Sender = async (
  { record, file, thumb },
  onProgress,
  signal,
) => {
  const t = record.target;
  if (record.owner && record.owner !== useAuth.getState().user?.id)
    throw new NetworkError(); // somebody else is signed in: wait for its owner
  if (!t) return; // a picture with nowhere to go (the lab) is only kept on the device
  const form = new FormData();
  form.append("file", file, `${record.id}.jpg`);
  if (thumb) form.append("thumb", thumb, `${record.id}.t.jpg`);
  form.append("meta", JSON.stringify(uploadMeta(record)));
  try {
    await http.post(
      t.entityType === "personal" ? "/me/pictures" : "/attachments",
      form,
      {
        signal,
        timeout: 120_000,
        // the app's default is JSON, which would turn the form into JSON; the browser adds the boundary itself
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (e.total) onProgress(Math.min(e.loaded / e.total, 0.99));
        },
      },
    );
  } catch (e) {
    if (axios.isCancel(e)) throw e;
    if (axios.isAxiosError(e)) {
      if (!e.response || e.code === "ECONNABORTED" || e.code === "ETIMEDOUT")
        throw new NetworkError();
      // the day or loan it belongs to may not have reached the server yet (made with no connection): wait for it, for up to three days
      if (
        e.response.status === 404 &&
        Date.now() - record.createdAt < 3 * 24 * 3600 * 1000
      )
        throw new NetworkError("Waiting for the record to reach the server");
      const msg = (
        e.response.data as { error?: { message?: string } } | undefined
      )?.error?.message;
      throw new Error(
        msg ?? `The server refused the picture (${e.response.status})`,
      );
    }
    throw e;
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// Showing stored pictures. The server wants the sign-in on every request, which an <img> cannot send, so the picture is fetched and shown
// from memory. Pictures never change once stored, so each is fetched once.
const blobUrls = new Map<string, Promise<string>>();
const LIMIT = 80;

export function fetchPicture(path: string): Promise<string> {
  let p = blobUrls.get(path);
  if (!p) {
    p = http
      .get<Blob>(path, { responseType: "blob", timeout: 60_000 })
      .then((r) => URL.createObjectURL(r.data));
    p.catch(() => blobUrls.delete(path)); // try again next time
    blobUrls.set(path, p);
    if (blobUrls.size > LIMIT) {
      const first = blobUrls.keys().next().value;
      if (first !== undefined) blobUrls.delete(first);
    }
  }
  return p;
}

export const pictureUrl = (id: string, thumb: boolean) =>
  `/attachments/${id}/${thumb ? "thumb" : "file"}`;
export const profileUrl = (userId: string) =>
  `/attachments/profile/${userId}?thumb=true`;

/** A stored picture's address on screen, or undefined while it loads (or when it cannot). */
export function usePicture(
  path: string | undefined,
  version?: unknown,
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (path)
      fetchPicture(path)
        .then((u) => {
          if (alive) setUrl(u);
        })
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path, version]);
  return url;
}

/** The profile picture of a person; undefined when they have none. A new one is picked up after `version` changes. */
export function useProfilePicture(
  userId: string | undefined,
  version?: unknown,
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (userId) {
      // not cached by address: the same address shows a new picture after a change
      http
        .get<Blob>(profileUrl(userId), {
          responseType: "blob",
          timeout: 30_000,
        })
        .then((r) => {
          if (alive) setUrl(URL.createObjectURL(r.data));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [userId, version]);
  return url;
}

export type { PhotoTarget };
