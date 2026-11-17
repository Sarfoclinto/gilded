import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkingDoc } from "@gold/core";
import { useAuth } from "@/features/auth/store";
import { isApiError } from "@/shared/api/errors";
import { isOnline, useConnectivity } from "@/shared/offline/connectivity";
import { toast } from "@/shared/ui/toast";
import { workingKeys, workingsApi } from "./api";
import { openSheetStore, type LocalSheet } from "./local";

export type SaveState = "saved" | "device" | "saving" | "offline" | "error";

const EMPTY: WorkingDoc = { notes: [] };

/**
 * One sheet, kept on the device and on the server. Edits are written to the device at once and sent to the server a moment later.
 * With no connection the sheet still works and says "Saved on this device"; it goes up when the connection returns.
 * If the server has a newer version (edited elsewhere), the server keeps its copy, stores ours as "<name> (other device)", and this
 * screen switches to the server's version, saying so.
 */
export function useSheet(id: string, fresh: boolean) {
  const owner = useAuth((s) => s.user?.id ?? "");
  const online = useConnectivity((s) => s.online);
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<LocalSheet | null>(null);
  const [state, setState] = useState<SaveState>("saved");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the sheet is a colleague's, shared with this person: it can be read and copied, never changed. */
  const [sharedBy, setSharedBy] = useState<string | null>(null);
  const readOnly = sharedBy !== null;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef(false);
  const latest = useRef<LocalSheet | null>(null);
  latest.current = sheet;
  const readOnlyRef = useRef(false);
  readOnlyRef.current = readOnly;

  // open: the device copy first (instant, works offline), then the server's if it is newer and we have nothing unsent
  useEffect(() => {
    let alive = true;
    (async () => {
      const store = await openSheetStore();
      const local = await store.get(id);
      if (!alive) return;
      if (local && local.owner === owner) {
        setSheet(local);
        setState(local.dirty ? "device" : "saved");
      } else if (fresh) {
        const s: LocalSheet = {
          id,
          owner,
          name: "Untitled",
          doc: EMPTY,
          version: 0,
          dirty: true,
          updatedAt: Date.now(),
        };
        await store.put(s);
        if (alive) {
          setSheet(s);
          setState("device");
        }
      }
      if (!isOnline()) {
        if (!local && !fresh && alive) setMissing(true);
        return;
      }
      try {
        const remote = await workingsApi.get(id);
        if (!alive) return;
        if (remote.mine === false) {
          // a colleague's sheet: shown as it is on the server, never written to this device's own sheets
          setSharedBy(remote.owner?.displayName ?? "a colleague");
          setSheet({
            id,
            owner: remote.owner?.id ?? "",
            name: remote.name,
            doc: remote.doc,
            version: remote.version,
            dirty: false,
            updatedAt: Date.now(),
          });
          setState("saved");
          return;
        }
        const cur = latest.current;
        if (!cur || (!cur.dirty && remote.version > cur.version)) {
          const s: LocalSheet = {
            id,
            owner,
            name: remote.name,
            doc: remote.doc,
            version: remote.version,
            dirty: false,
            updatedAt: Date.now(),
          };
          await store.put(s);
          if (alive) {
            setSheet(s);
            setState("saved");
          }
        }
      } catch (e) {
        if (!alive) return;
        if (isApiError(e) && e.status === 404 && !latest.current)
          setMissing(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, owner, fresh]);

  const push = useCallback(async () => {
    const cur = latest.current;
    if (!cur || !cur.dirty || inflight.current) return;
    // a new sheet nobody has written on yet is not worth keeping
    if (cur.version === 0 && !cur.doc.notes.length && cur.name === "Untitled") {
      setState("saved");
      return;
    }
    if (!isOnline()) {
      setState("offline");
      return;
    }
    inflight.current = true;
    setState("saving");
    try {
      const r = await workingsApi.save(cur.id, {
        name: cur.name,
        doc: cur.doc,
        baseVersion: cur.version || null,
      });
      const store = await openSheetStore();
      const now = latest.current!;
      if (r.copy && r.data.doc) {
        // edited elsewhere: the server kept its version; ours lives on as a second sheet
        const s: LocalSheet = {
          ...now,
          name: r.data.name,
          doc: r.data.doc,
          version: r.data.version,
          dirty: false,
          updatedAt: Date.now(),
        };
        await store.put(s);
        setSheet(s);
        toast.info(
          `This sheet was changed on another device. Your version was kept as "${r.copy.name}".`,
        );
      } else {
        // only clear "dirty" if nothing changed while the save was on its way
        const unchanged = now.doc === cur.doc && now.name === cur.name;
        const s: LocalSheet = {
          ...now,
          version: r.data.version,
          dirty: !unchanged,
          updatedAt: now.updatedAt,
        };
        await store.put(s);
        setSheet(s);
        if (!unchanged) schedule(400);
      }
      setState("saved");
      setError(null);
      void qc.invalidateQueries({ queryKey: workingKeys.all });
    } catch (e) {
      const msg = isApiError(e) ? e.message : "Could not save to the server.";
      if (
        isApiError(e) &&
        (e.kind === "offline" || e.kind === "network" || e.kind === "timeout")
      )
        setState("offline");
      else {
        setState("error");
        setError(msg);
      }
    } finally {
      inflight.current = false;
    }
  }, [qc]);

  const schedule = useCallback(
    (ms = 1500) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void push(), ms);
    },
    [push],
  );

  /** Change the sheet. Written to the device now, to the server shortly. */
  const update = useCallback(
    (fn: (s: LocalSheet) => Partial<Pick<LocalSheet, "name" | "doc">>) => {
      if (readOnlyRef.current) return;
      setSheet((cur) => {
        if (!cur) return cur;
        const next: LocalSheet = {
          ...cur,
          ...fn(cur),
          dirty: true,
          updatedAt: Date.now(),
        };
        latest.current = next;
        void openSheetStore().then((st) => st.put(next));
        return next;
      });
      setState("device");
      schedule();
    },
    [schedule],
  );

  useEffect(() => {
    if (online && sheet?.dirty) schedule(300);
  }, [online, sheet?.dirty, schedule]);
  // a shared sheet follows the owner's changes: look again every 20 seconds while it is open
  useEffect(() => {
    if (!readOnly) return;
    const t = setInterval(() => {
      if (!isOnline()) return;
      workingsApi
        .get(id)
        .then((r) => {
          if (r.mine === false && r.version !== latest.current?.version)
            setSheet((cur) =>
              cur
                ? { ...cur, name: r.name, doc: r.doc, version: r.version }
                : cur,
            );
        })
        .catch((e) => {
          if (isApiError(e) && e.status === 404) setMissing(true);
        });
    }, 20_000);
    return () => clearInterval(t);
  }, [readOnly, id]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  // leaving the page: try once more right away
  useEffect(() => {
    const flush = () => {
      if (latest.current?.dirty) void push();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [push]);

  return {
    sheet,
    state,
    error,
    missing,
    readOnly,
    sharedBy,
    update,
    saveNow: () => void push(),
  };
}
