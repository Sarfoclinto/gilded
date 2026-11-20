import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input, Modal, Select } from "antd";
import {
  CloudOffIcon,
  LockIcon,
  NotebookTabsIcon,
  PlusIcon,
  Settings2Icon,
  ShieldAlertIcon,
  UsersIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { useConnectivity } from "@/shared/offline/connectivity";
import { CoinEdge } from "@/shared/ui/BrandMark";
import { Chip } from "@/shared/ui/Chip";
import { gsApi, useGsHome, useGsMutation, type Home, type Sheet } from "./api";
import { useGsOutbox } from "./local";
import { money, qty, roleLabel, signed } from "./model";

/** Every group the person is in, each with its sheets and their balances. Nobody else's groups appear here, whatever their role. */
export default function GroupSheetsPage() {
  const navigate = useNavigate();
  const online = useConnectivity((s) => s.online);
  const home = useGsHome();
  const pending = useGsOutbox((s) => s.items);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useGsMutation((n: string) =>
    gsApi.createGroup({ id: crypto.randomUUID(), name: n }),
  );
  const h = home.data;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-4 lg:p-6">
      <header className="relative isolate overflow-hidden rounded-2xl bg-navy p-5 text-white sm:p-7">
        <CoinEdge className="pointer-events-none absolute -right-16 -top-20 -z-10 size-64 text-gold/35 sm:size-80" />
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
            <NotebookTabsIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">
              Group Sheets
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              Running records a group keeps for itself: kitchen fees, mercury
              sales, a welfare pot. Only the group's members see them. No
              company role opens a group, and nothing here touches the drawer or
              the books.
            </p>
          </div>
          {h?.canCreate ? (
            <button
              type="button"
              disabled={!online}
              onClick={() => {
                setName("");
                setCreating(true);
              }}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-gold px-4 text-sm font-semibold text-navy disabled:opacity-60 sm:w-auto"
            >
              <PlusIcon className="size-4" aria-hidden />
              New group
            </button>
          ) : null}
        </div>
      </header>

      {!online ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <CloudOffIcon className="size-4 shrink-0" aria-hidden />
          No connection. Balances are as this device last saw them; new entries
          are kept here and sent when the connection returns.
        </p>
      ) : null}

      {h?.needKeeper.map((g) => (
        <NeedsKeeper key={g.id} group={g} />
      ))}

      {home.isLoading && !h ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : null}

      {h?.groups.map((g) => (
        <section key={g.id} aria-labelledby={`g-${g.id}`} className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={`g-${g.id}`} className="font-display text-xl font-semibold">
              {g.name}
            </h2>
            <Chip tone={g.myRole === "keeper" ? "amber" : "grey"}>
              {roleLabel(g.myRole)}
            </Chip>
            <Link
              to={paths.groupSheets.group.to(g.id)}
              className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-muted"
            >
              {g.myRole === "keeper" ? (
                <Settings2Icon className="size-4" aria-hidden />
              ) : (
                <UsersIcon className="size-4" aria-hidden />
              )}
              {g.myRole === "keeper" ? "Manage group" : "People and activity"}
            </Link>
          </div>
          {g.sheets.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {g.sheets.map((s) => (
                <SheetCard
                  key={s.id}
                  sheet={s}
                  waiting={
                    pending.filter((p) => p.sheetId === s.id && !p.problem)
                      .length
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              {g.myRole === "keeper" ? (
                <>
                  No sheets yet.{" "}
                  <Link
                    className="font-semibold text-brand underline"
                    to={`${paths.groupSheets.group.to(g.id)}?tab=sheets`}
                  >
                    Start one
                  </Link>
                  , for example "Kitchen fees".
                </>
              ) : (
                "No sheets you can see yet."
              )}
            </p>
          )}
        </section>
      ))}

      {h && !h.groups.length && !h.needKeeper.length ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-gold/15 text-brand">
            <LockIcon className="size-7" aria-hidden />
          </span>
          <p className="font-display text-xl font-semibold">
            You are not in a group yet
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {h.canCreate
              ? "Create a group, add the people who keep the money (by name, or everyone at a branch), then start a sheet for each pot."
              : "When someone adds you to a group, you get a notification and its sheets appear here."}
          </p>
        </div>
      ) : null}

      <Modal
        open={creating}
        title="New group"
        okText="Create"
        confirmLoading={create.isPending}
        okButtonProps={{ disabled: !name.trim() }}
        onCancel={() => setCreating(false)}
        onOk={async () => {
          const g = await create.mutateAsync(name.trim());
          setCreating(false);
          navigate(`${paths.groupSheets.group.to(g.id)}?tab=people`);
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          You will be its keeper. Next you add people and start its sheets.
        </p>
        <Input
          autoFocus
          size="large"
          maxLength={80}
          placeholder="For example: Anyanso staff"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Modal>
    </div>
  );
}

function SheetCard({ sheet: s, waiting }: { sheet: Sheet; waiting: number }) {
  const negative = Number(s.balance) < 0;
  return (
    <li>
      <Link
        to={paths.groupSheets.sheet.to(s.id)}
        className={`group flex h-full flex-col rounded-2xl border bg-card p-4 transition hover:border-gold hover:shadow-sm ${s.closed ? "border-dashed border-border opacity-80" : "border-border"}`}
      >
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{s.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {[s.branchName, s.access === "read" ? "see only" : null]
                .filter(Boolean)
                .join(" · ") || " "}
            </span>
          </span>
          {s.closed ? <Chip>Closed</Chip> : null}
          {waiting ? <Chip tone="sky">{waiting} waiting</Chip> : null}
        </div>
        <span
          className={`tnum mt-3 font-display text-3xl font-semibold ${negative ? "text-red-700 dark:text-red-400" : ""}`}
        >
          {money(s.balance)}
        </span>
        {s.kind === "quantity" ? (
          <span className="tnum text-sm font-semibold text-muted-foreground">
            {qty(s.stock, s.unit)} in hand
          </span>
        ) : null}
        {s.kind === "people" ? (
          <span className="text-sm text-muted-foreground">
            Savings of {s.people?.length ?? 0}{" "}
            {s.people?.length === 1 ? "person" : "people"}
          </span>
        ) : null}
        <span className="tnum mt-1 text-xs text-muted-foreground">
          Today{" "}
          <span className="text-emerald-700 dark:text-emerald-400">
            +{Number(s.todayIn).toLocaleString("en-GH")}
          </span>
          {" · "}
          <span className="text-red-700 dark:text-red-400">
            −{Number(s.todayOut).toLocaleString("en-GH")}
          </span>
        </span>
        {s.last ? (
          <span className="mt-3 block truncate border-t border-border pt-2 text-xs text-muted-foreground">
            Last:{" "}
            <b className="tnum font-semibold text-foreground">
              {signed(s.last.amount)}
            </b>{" "}
            {s.last.note ? `${s.last.note} · ` : ""}
            {s.last.writtenBy.displayName}
          </span>
        ) : (
          <span className="mt-3 block border-t border-border pt-2 text-xs text-muted-foreground">
            No entries yet
          </span>
        )}
      </Link>
    </li>
  );
}

/** Shown only to people who manage people: a group whose last keeper's account was switched off. Its sheets stay closed to them. */
function NeedsKeeper({ group }: { group: Home["needKeeper"][number] }) {
  const [userId, setUserId] = useState<string>();
  const name = useGsMutation(
    (u: string) => gsApi.nameKeeper(group.id, u),
    "New keeper named",
  );
  return (
    <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="flex items-start gap-2 text-sm">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <b>{group.name}</b> has no keeper: its keeper's account was switched
          off. Name a new keeper from the people still in it. You will not see
          its sheets, and the group's members will see that you did this.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Select
          size="large"
          className="min-w-56 flex-1"
          placeholder="Choose the new keeper"
          value={userId}
          onChange={setUserId}
          options={group.members.map((m) => ({
            value: m.id,
            label: `${m.displayName} (${roleLabel(m.role).toLowerCase()})`,
          }))}
        />
        <button
          type="button"
          disabled={!userId || name.isPending}
          onClick={() => userId && name.mutate(userId)}
          className="min-h-10 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Make keeper
        </button>
      </div>
    </section>
  );
}
