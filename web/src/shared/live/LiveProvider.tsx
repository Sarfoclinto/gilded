import { useEffect, type PropsWithChildren } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/store";
import { notificationKeys } from "@/features/notifications/api";
import { toast } from "@/shared/ui/toast";
import { startLive } from "./liveConnection";

/** Which cached lists a "something changed" signal refreshes. Unknown topics are ignored. */
const TOPIC_KEYS: Record<string, QueryKey[]> = {
  transfers: [["transfers"], ["review"]],
  review: [["review"]],
  days: [["days"]],
  payments: [["payments"], ["transactions"]],
  prices: [["prices"]],
  debts: [["debts"], ["collateral"]],
  transactions: [["transactions"]],
  ledger: [["days"], ["review"], ["transfers"]],
};

/**
 * Keeps the open screens fresh while signed in: the server pushes "this changed" and the matching cached data is refetched
 * (only the screens that are showing it actually fetch). Also shows new notifications as they arrive.
 * Without a connection nothing breaks: screens simply refresh when they are opened, as before.
 */
export function LiveProvider({ children }: PropsWithChildren) {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);

  useEffect(() => {
    if (status !== "authenticated") return;
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      for (const topic of pending)
        for (const queryKey of TOPIC_KEYS[topic] ?? [])
          void qc.invalidateQueries({ queryKey });
      pending.clear();
    };
    const stop = startLive({
      // Several signals arrive together (one purchase writes many rows): refresh once.
      changed: (topic) => {
        pending.add(topic);
        timer ??= setTimeout(flush, 300);
      },
      notification: (n) => {
        void qc.invalidateQueries({ queryKey: notificationKeys.all });
        toast.info(n.title);
      },
      resync: () => void qc.invalidateQueries(),
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [status, qc]);

  return children;
}
