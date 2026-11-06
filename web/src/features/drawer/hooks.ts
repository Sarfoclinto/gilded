import { useEffect, useMemo } from "react";
import { useAuth } from "@/features/auth/store";
import { useApiQuery } from "@/shared/api/hooks";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { dayKeys, daysApi, exchangeKeys } from "./api";
import { projectDrawer, type Pending } from "./projection";
import { useSettings } from "@/features/settings/api";
import { OUTBOX } from "./schemas";
import { usePeers } from "@/shared/offline/hubShare";
import { pushSnapshot } from "@/shared/offline/hubSync";
import { useHubState } from "@/shared/platform/platform";

const RELEVANT = new Set<string>([
  OUTBOX.MOVEMENT,
  OUTBOX.EXCHANGE,
  OUTBOX.PAY,
  "transaction.create",
]);

/** The drawer for a branch as this device sees it: server snapshot plus anything still waiting to be sent. */
export function useDrawer(branchId: string | null) {
  const { entries } = useOutbox();
  const twoStep = useSettings()["payout.twoStep"];
  const query = useApiQuery({
    queryKey: dayKeys.custom("current", { branchId }),
    queryFn: ({ signal }) => daysApi.current(branchId as string, signal),
    enabled: !!branchId,
    // Always re-ask on opening a screen: a cached snapshot may be hours old (it is kept for offline use, not for trust).
    staleTime: 0,
    refetchOnMount: "always",
  });
  const peers = usePeers((s) => s.entries);
  const selfId = useHubState((s) => s.hub.selfId);
  // Commands saved on the other computers of this branch count against the drawer too, so nobody is offered notes a colleague just used.
  const view = useMemo(() => {
    const own = entries.filter(
      (e) => e.status !== "failed" && RELEVANT.has(e.type),
    ) as unknown as Pending[];
    const mine = new Set(own.map((e) => e.id));
    const others = peers
      .filter(
        (p) =>
          p.deviceId !== selfId &&
          RELEVANT.has(p.command.type) &&
          !mine.has(p.command.id),
      )
      .map((p) => p.command) as unknown as Pending[];
    const withPeers = projectDrawer(
      query.data ?? null,
      [...own, ...others],
      branchId ?? "",
      twoStep,
    );
    // "Not sent yet" counts what this computer holds, not what its colleagues' computers do.
    return {
      ...withPeers,
      pendingCount: projectDrawer(
        query.data ?? null,
        own,
        branchId ?? "",
        twoStep,
      ).pendingCount,
    };
  }, [query.data, entries, peers, selfId, branchId, twoStep]);
  // Give the hub the server's latest answer, so it counts from the same starting point.
  useEffect(() => {
    if (query.data && !query.isFetching) pushSnapshot(query.data);
  }, [query.data, query.isFetching]);
  /** False while an answer is still on its way, so a screen does not act on an old snapshot. */
  const settled = !query.isFetching;
  return { view, state: query.data ?? null, query, settled };
}

/** Same, for the branch the person is working in. */
export function useActiveDrawer() {
  const branchId = useAuth((s) => s.activeBranchId);
  return useDrawer(branchId);
}

export function useDayHistory(params: {
  branchId: string | null;
  signoff?: string;
}) {
  return useApiQuery({
    queryKey: dayKeys.list({ ...params }),
    queryFn: ({ signal }) =>
      daysApi.history(
        { branchId: params.branchId as string, signoff: params.signoff },
        signal,
      ),
    enabled: !!params.branchId,
    staleTime: 0,
  });
}

/** One day's own movements ("This day only"). */
export function useDayActivity(dayId: string | null) {
  return useApiQuery({
    queryKey: dayKeys.custom("activity", { dayId }),
    queryFn: ({ signal }) => daysApi.activity(dayId as string, signal),
    enabled: !!dayId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** What the books say the branch holds (cash, goods, debts, amounts owed, held gold). Needs an open day. */
export function useClosingPreview(dayId: string | null) {
  return useApiQuery({
    queryKey: dayKeys.custom("preview", { dayId }),
    queryFn: ({ signal }) => daysApi.preview(dayId as string, signal),
    enabled: !!dayId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** The branch's own recent note exchanges (needs a connection). */
export function useBranchExchanges(branchId: string | null) {
  return useApiQuery({
    queryKey: exchangeKeys.custom("list", { branchId }),
    queryFn: ({ signal }) => daysApi.exchanges(branchId as string, signal),
    enabled: !!branchId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
