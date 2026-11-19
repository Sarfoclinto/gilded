import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import type { MenuFlags } from "@/layouts/menu";
import { ApiError, errorMessage } from "@/shared/api/errors";
import { useConnectivity } from "@/shared/offline/connectivity";
import { gsApi, gsKeys } from "./api";
import { useGsOutbox } from "./local";

const VISIBLE = (user: string) => `gold.gs.visible.${user}`;

/** Whether this person has anything in Group Sheets (remembered per person, so the link shows at once on the next visit). */
export const useGsVisible = create<{
  user: string;
  visible: boolean;
  load: (user: string) => void;
  set: (v: boolean) => void;
}>((set, get) => ({
  user: "",
  visible: false,
  load: (user) => {
    let v = false;
    try {
      v = !!user && localStorage.getItem(VISIBLE(user)) === "1";
    } catch {
      /* not remembered */
    }
    set({ user, visible: v });
  },
  set: (v) => {
    try {
      if (get().user) localStorage.setItem(VISIBLE(get().user), v ? "1" : "0");
    } catch {
      /* not remembered */
    }
    set({ visible: v });
  },
}));

/** Menu flags from what the server said about the person. */
export function useMenuFlags(): MenuFlags {
  const canCreate = useHasPermission(PERMISSIONS.GROUPS_CREATE);
  const visible = useGsVisible((s) => s.visible);
  return { groupSheets: canCreate || visible };
}

/**
 * Runs beside every page: sends entries written without a connection (oldest first, each once), and checks once a session whether the
 * person is in a group, so the menu link can show. An entry the server refuses is kept with the reason, for the person to see and drop.
 */
export function GroupSheetsSync() {
  const user = useAuth((s) => s.user?.id ?? "");
  const online = useConnectivity((s) => s.online);
  const items = useGsOutbox((s) => s.items);
  const qc = useQueryClient();
  const busy = useRef(false);
  const checked = useRef("");

  useEffect(() => {
    useGsOutbox.getState().load(user);
    useGsVisible.getState().load(user);
  }, [user]);

  useEffect(() => {
    if (!user || !online || checked.current === user) return;
    checked.current = user;
    void gsApi
      .home()
      .then((h) =>
        useGsVisible
          .getState()
          .set(h.groups.length > 0 || h.needKeeper.length > 0 || h.canCreate),
      )
      .catch(() => undefined);
  }, [user, online]);

  useEffect(() => {
    const waiting = items.filter((i) => !i.problem);
    if (!user || !online || busy.current || !waiting.length) return;
    busy.current = true;
    void (async () => {
      let sent = 0;
      for (const e of [...waiting].sort((a, b) =>
        a.writtenAt.localeCompare(b.writtenAt),
      )) {
        const { problem: _p, ...entry } = e;
        try {
          await gsApi.addEntry(entry);
          useGsOutbox.getState().done(e.id);
          sent++;
        } catch (err) {
          const api = err instanceof ApiError ? err : null;
          if (
            api &&
            !api.retryable &&
            api.kind !== "offline" &&
            api.status !== 401
          )
            useGsOutbox.getState().fail(e.id, errorMessage(api));
          else break; // no connection or the server is busy: try again later, in order
        }
      }
      busy.current = false;
      if (sent) await qc.invalidateQueries({ queryKey: gsKeys.all });
    })();
  }, [items, user, online, qc]);

  // a gentle retry while something is still waiting (a server that was busy)
  useEffect(() => {
    if (!online || !items.some((i) => !i.problem)) return;
    const t = setInterval(
      () => useGsOutbox.setState((s) => ({ items: [...s.items] })),
      30_000,
    );
    return () => clearInterval(t);
  }, [online, items]);

  return null;
}
