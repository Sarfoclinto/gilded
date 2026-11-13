import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { PERMISSIONS } from "@/config/permissions";
import { hasAccess } from "@/features/auth/access";
import { useAuth } from "@/features/auth/store";
import {
  localPeople,
  useCustomerDirectory,
} from "@/features/customers/directory";
import { transactionKeys } from "@/features/transactions/api";
import type { Transaction } from "@/features/transactions/schemas";
import { useApiQuery } from "@/shared/api/hooks";
import { useConnectivity } from "@/shared/offline/connectivity";
import { searchApi, searchKeys, type GroupKey, type SearchResult } from "./api";
import { searchDevice, type LocalSection } from "./local";
import { rank, tidy } from "./match";
import { searchablePages, searchPages, type PageHit } from "./pages";
import {
  GROUP_LABEL,
  pageRow,
  toRows,
  type Abilities,
  type Row,
  type RowGroup,
} from "./rows";

export interface Section {
  key: RowGroup;
  label: string;
  /** How many there are in all (the rows are only the best few). */
  total: number;
  rows: Row[];
}

/** Waits until typing pauses, so the server is asked once per pause and not once per letter. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Puts the answer together: the server's groups (or, with no connection, what the device holds), and the pages and actions.
 * "Go to" comes first when the typing clearly names a page ("close", "drawer"), otherwise last, so a customer called Drew
 * is not pushed down by the Cash drawer.
 */
export function assemble(
  q: string,
  server: SearchResult | null,
  device: LocalSection[],
  pages: PageHit[],
  can: Abilities,
  only: RowGroup | null,
): Section[] {
  const out: Section[] = [];
  if (server)
    for (const g of server.groups)
      out.push({
        key: g.key,
        label: GROUP_LABEL[g.key],
        total: g.total,
        rows: toRows(g, can),
      });
  else
    for (const d of device)
      out.push({
        key: d.key,
        label: GROUP_LABEL[d.key],
        total: d.total,
        rows: d.rows,
      });
  if (pages.length > 0) {
    const section: Section = {
      key: "pages",
      label: GROUP_LABEL.pages,
      total: pages.length,
      rows: pages.map(pageRow),
    };
    if (rank(pages[0]!.title, q) >= 80) out.unshift(section);
    else out.push(section);
  }
  return only ? out.filter((s) => s.key === only) : out;
}

export const MIN_LENGTH = 2;

export function useGlobalSearch(typed: string, only: RowGroup | null) {
  const user = useAuth((s) => s.user);
  const branchId = useAuth((s) => s.activeBranchId);
  const online = useConnectivity((s) => s.online);
  const qc = useQueryClient();
  const q = useDebounced(tidy(typed), 180);
  const ready = q.length >= MIN_LENGTH;
  const serverGroup = only && only !== "pages" ? (only as GroupKey) : undefined;

  const query = useApiQuery({
    queryKey: searchKeys.custom("q", { q, group: serverGroup ?? null }),
    queryFn: ({ signal }) =>
      searchApi.search(
        q,
        serverGroup ? { group: serverGroup, limit: 25 } : {},
        signal,
      ),
    enabled: ready && online && only !== "pages",
    staleTime: 20_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const can = useMemo<Abilities>(
    () => ({
      customers: hasAccess(user, { permission: PERMISSIONS.CUSTOMERS_READ }),
      buy: hasAccess(user, { permission: PERMISSIONS.TRANSACTIONS_CREATE }),
    }),
    [user],
  );
  const allPages = useMemo(() => searchablePages(user), [user]);
  // With no connection (or when the server could not be reached), search what the device holds.
  const unreachable =
    !online ||
    (!!query.error &&
      (query.error.retryable || query.error.kind === "offline"));
  const directoryStamp = useCustomerDirectory(
    (s) => s.fetchedAt + s.pending.length,
  );

  const sections = useMemo(() => {
    if (!ready) return [];
    const pages = searchPages(allPages, q, only === "pages" ? 20 : 4);
    let device: LocalSection[] = [];
    if (unreachable) {
      const purchases =
        (branchId
          ? qc.getQueryData<Transaction[]>(transactionKeys.list({ branchId }))
          : undefined) ?? [];
      device = searchDevice(
        q,
        { people: localPeople(branchId), purchases },
        can,
        only ? 25 : 5,
      );
    }
    // While a new answer is on its way the last one stays on screen, but only if it was for the same kind of question.
    const server = !unreachable && query.data ? query.data : null;
    return assemble(q, server, device, pages, can, only);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    q,
    only,
    allPages,
    unreachable,
    query.data,
    can,
    branchId,
    qc,
    directoryStamp,
  ]);

  return {
    /** What is being searched for (after the pause in typing). */
    q,
    ready,
    sections,
    /** The first answer for this question has not arrived yet. */
    loading: ready && !unreachable && only !== "pages" && query.isPending,
    /** A newer answer is on its way; what is shown is the previous one. */
    refreshing: ready && !unreachable && query.isFetching,
    /** Showing only what this device holds. */
    deviceOnly: ready && unreachable,
    /** The server answered with an error that is not about the connection. */
    failed: ready && !!query.error && !unreachable ? query.error : null,
    /** Typing has moved on and the pause has not happened yet. */
    waiting: tidy(typed) !== q,
  };
}
