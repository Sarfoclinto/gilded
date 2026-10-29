import type { ReactNode } from "react";
import { InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectInput } from "@/shared/ui/SelectField";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Hide this column below a screen width, so a narrow laptop still fits. */
  hideBelow?: "lg" | "xl";
  className?: string;
}

const hide = {
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

/**
 * The list pattern for the whole app: a real table from tablet width up, cards on a phone.
 * Rows are links or buttons (`onRowClick`), keyboard reachable. Loading shows grey rows, not a blank page.
 */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  onRowClick,
  mobileCard,
  loading,
  refreshing,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** What one row looks like on a phone. Without it the table scrolls sideways. */
  mobileCard?: (row: T) => ReactNode;
  loading?: boolean;
  /** Newer data is on its way; dim the rows a little. */
  refreshing?: boolean;
  empty?: ReactNode;
}) {
  if (loading && rows.length === 0) return <SkeletonRows />;
  if (rows.length === 0)
    return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;

  const click = (row: T) => (onRowClick ? () => onRowClick(row) : undefined);
  return (
    <div className={cn("transition-opacity", refreshing && "opacity-60")}>
      {mobileCard ? (
        <ul className="space-y-2 md:hidden">
          {rows.map((r) => (
            <li key={getKey(r)}>
              <button
                type="button"
                onClick={click(r)}
                disabled={!onRowClick}
                className="block w-full rounded-xl border border-border bg-card p-3 text-left active:bg-muted"
              >
                {mobileCard(r)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className={cn(
          "overflow-x-auto rounded-xl border border-border bg-card",
          mobileCard && "hidden md:block",
        )}
      >
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-3 py-2.5 font-semibold",
                    c.align === "right" ? "text-right" : "text-left",
                    c.hideBelow && hide[c.hideBelow],
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr
                key={getKey(r)}
                onClick={click(r)}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter") onRowClick(r);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  onRowClick &&
                    "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-3 align-middle",
                      c.align === "right" && "text-right",
                      c.hideBelow && hide[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card px-4 py-12 text-center">
      <InboxIcon className="mb-2 size-8 text-muted-foreground/60" />
      <p className="font-semibold">{title}</p>
      {hint ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-xl border border-border bg-muted/50"
        />
      ))}
    </div>
  );
}

/** "26–50 of 276" with previous and next, and how many rows per page. */
export function Pager({
  text,
  page,
  pages,
  onPage,
  size,
  sizes,
  onSize,
}: {
  text: string;
  page: number;
  pages: number;
  onPage: (p: number) => void;
  size?: number;
  sizes?: readonly number[];
  onSize?: (n: number) => void;
}) {
  const btn =
    "min-h-10 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="tnum text-muted-foreground">{text}</span>
      <div className="flex items-center gap-2">
        {sizes && onSize && size ? (
          <label className="hidden items-center gap-2 text-muted-foreground sm:flex">
            Rows
            <SelectInput
              aria-label="Rows per page"
              value={String(size)}
              onChange={(e) => onSize(Number(e.target.value))}
              className="min-h-10 w-20"
            >
              {sizes.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </SelectInput>
          </label>
        ) : null}
        <button
          type="button"
          className={btn}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="tnum px-1 text-muted-foreground">
          {page} / {Math.max(pages, 1)}
        </span>
        <button
          type="button"
          className={btn}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
