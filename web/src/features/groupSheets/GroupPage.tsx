import { useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Input, Modal, Segmented, Select } from "antd";
import {
  ArrowLeftIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  DoorOpenIcon,
  PencilLineIcon,
  PlusIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useAllBranches } from "@/features/branches/api";
import { useColleagues } from "@/features/personal/api";
import { errorMessage } from "@/shared/api/errors";
import { useConnectivity } from "@/shared/offline/connectivity";
import { Chip } from "@/shared/ui/Chip";
import {
  gsApi,
  useGsActivity,
  useGsGroup,
  useGsMutation,
  type Access,
  type Group,
  type GroupRole,
  type SheetKind,
} from "./api";
import { activityText, money, qty, roleLabel } from "./model";

type Tab = "sheets" | "people" | "access" | "activity";
const roleOptions = [
  { value: "writer", label: "Writer: sees and adds entries" },
  { value: "reader", label: "Reader: only looks" },
  { value: "keeper", label: "Keeper: runs the group" },
];
const btn =
  "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold";

/** A group: its sheets, its people, who sees which sheet, and what has happened. Keepers change things; everyone in it can look. */
export default function GroupPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useGsGroup(id);
  const g = q.data;
  const keeper = g?.myRole === "keeper";
  const asked = params.get("tab") as Tab | null;
  const tab: Tab =
    asked &&
    ["sheets", "people", "access", "activity"].includes(asked) &&
    (asked !== "access" || keeper)
      ? asked
      : "sheets";
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const rename = useGsMutation(
    (n: string) => gsApi.renameGroup(id, n),
    "Renamed",
  );

  if (q.error && !g) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          to={paths.groupSheets.href}
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Group Sheets
        </Link>
        <p
          role="alert"
          className="rounded-xl border border-border bg-card p-4 text-sm"
        >
          {(q.error as { status?: number }).status === 404
            ? "This group does not exist, or you are no longer in it."
            : errorMessage(q.error)}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-10 sm:p-4 lg:p-6">
      <Link
        to={paths.groupSheets.href}
        className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Group Sheets
      </Link>
      {!g ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <header className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-semibold">{g.name}</h1>
              <p className="text-sm text-muted-foreground">
                {g.members.length}{" "}
                {g.members.length === 1 ? "person" : "people"} ·{" "}
                {g.sheets.length} sheet{g.sheets.length === 1 ? "" : "s"} · you
                are {roleLabel(g.myRole).toLowerCase()}
              </p>
            </div>
            {keeper ? (
              <button
                type="button"
                onClick={() => {
                  setName(g.name);
                  setRenaming(true);
                }}
                className={`${btn} border border-border hover:bg-muted`}
              >
                <PencilLineIcon className="size-4" aria-hidden />
                Rename
              </button>
            ) : null}
          </header>

          {keeper && g.keepers === 1 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              You are the only keeper. Add a second keeper, so the group is not
              locked if you leave or your account is switched off.
            </p>
          ) : null}

          <Segmented
            block
            size="large"
            value={tab}
            onChange={(v) => setParams({ tab: String(v) }, { replace: true })}
            options={[
              { label: "Sheets", value: "sheets" },
              { label: "People", value: "people" },
              ...(keeper ? [{ label: "Who sees what", value: "access" }] : []),
              { label: "Activity", value: "activity" },
            ]}
          />

          {tab === "sheets" ? <SheetsTab group={g} /> : null}
          {tab === "people" ? <PeopleTab group={g} /> : null}
          {tab === "access" && keeper ? <AccessTab group={g} /> : null}
          {tab === "activity" ? <ActivityTab group={g} /> : null}

          <Modal
            open={renaming}
            title="Rename the group"
            okText="Save"
            confirmLoading={rename.isPending}
            okButtonProps={{ disabled: !name.trim() }}
            onCancel={() => setRenaming(false)}
            onOk={async () => {
              await rename.mutateAsync(name.trim());
              setRenaming(false);
            }}
          >
            <Input
              autoFocus
              size="large"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Modal>
        </>
      )}
    </div>
  );
}

function SheetsTab({ group: g }: { group: Group }) {
  const keeper = g.myRole === "keeper";
  const online = useConnectivity((s) => s.online);
  const branches = useAllBranches();
  const [open, setOpen] = useState(false);
  const blank = {
    name: "",
    kind: "money" as SheetKind,
    unit: "kg",
    openingQuantity: "",
    branchId: undefined as string | undefined,
    opening: "",
    openingDate: "",
  };
  const [form, setForm] = useState(blank);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const create = useGsMutation(
    (f: typeof form) =>
      gsApi.createSheet(g.id, {
        id: crypto.randomUUID(),
        name: f.name.trim(),
        kind: f.kind,
        unit: f.kind === "quantity" ? f.unit.trim() : undefined,
        openingQuantity:
          f.kind === "quantity" && f.openingQuantity.trim()
            ? f.openingQuantity.replace(/[,\s]/g, "")
            : undefined,
        branchId: f.branchId ?? null,
        openingBalance:
          f.kind !== "people" && f.opening.trim()
            ? f.opening.replace(/[,\s]/g, "")
            : undefined,
        openingDate: f.openingDate || null,
      }),
    "Sheet started",
  );
  const update = useGsMutation(
    (v: { id: string; name?: string; closed?: boolean }) =>
      gsApi.updateSheet(v.id, v),
  );
  const remove = useGsMutation(
    (sid: string) => gsApi.deleteSheet(sid),
    "Sheet deleted",
  );
  const openingOk =
    !form.opening.trim() ||
    /^-?\d{1,12}(\.\d{1,2})?$/.test(form.opening.replace(/[,\s]/g, ""));
  const quantityOk =
    form.kind !== "quantity" ||
    (!!form.unit.trim() &&
      form.unit.trim().length <= 12 &&
      (!form.openingQuantity.trim() ||
        /^\d{1,12}(\.\d{1,3})?$/.test(
          form.openingQuantity.replace(/[,\s]/g, ""),
        )));

  return (
    <section className="space-y-3">
      {keeper ? (
        <button
          type="button"
          disabled={!online}
          onClick={() => {
            setForm(blank);
            setOpen(true);
          }}
          className={`${btn} bg-navy text-white disabled:opacity-50`}
        >
          <PlusIcon className="size-4" aria-hidden />
          New sheet
        </button>
      ) : null}
      {g.sheets.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {g.sheets.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <Link
                to={paths.groupSheets.sheet.to(s.id)}
                className="min-w-0 flex-1 basis-48"
              >
                <span className="block truncate font-semibold">
                  {s.name} {s.closed ? <Chip>Closed</Chip> : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {[
                    s.branchName,
                    `${s.entries} entr${s.entries === 1 ? "y" : "ies"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
              <span
                className={`tnum font-semibold ${Number(s.balance) < 0 ? "text-red-700" : ""}`}
              >
                {money(s.balance)}
                {s.kind === "quantity" ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {qty(s.stock, s.unit)} in hand
                  </span>
                ) : null}
              </span>
              {keeper ? (
                <span className="flex gap-1">
                  <button
                    type="button"
                    title="Rename"
                    aria-label={`Rename ${s.name}`}
                    onClick={() => setRenaming({ id: s.id, name: s.name })}
                    className="grid size-10 place-items-center rounded-lg hover:bg-muted"
                  >
                    <PencilLineIcon className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    title={s.closed ? "Reopen" : "Close"}
                    aria-label={`${s.closed ? "Reopen" : "Close"} ${s.name}`}
                    disabled={update.isPending}
                    onClick={() =>
                      s.closed
                        ? update.mutate({ id: s.id, closed: false })
                        : Modal.confirm({
                            title: `Close "${s.name}"?`,
                            content:
                              "It stays readable, keeps its balance and history, and takes no new entries. You can reopen it.",
                            okText: "Close sheet",
                            onOk: () =>
                              update.mutateAsync({ id: s.id, closed: true }),
                          })
                    }
                    className="grid size-10 place-items-center rounded-lg hover:bg-muted"
                  >
                    {s.closed ? (
                      <ArchiveRestoreIcon className="size-4" aria-hidden />
                    ) : (
                      <ArchiveIcon className="size-4" aria-hidden />
                    )}
                  </button>
                  {s.entries === 0 ? (
                    <button
                      type="button"
                      title="Delete"
                      aria-label={`Delete ${s.name}`}
                      onClick={() =>
                        Modal.confirm({
                          title: `Delete "${s.name}"?`,
                          content: "It has no entries.",
                          okText: "Delete",
                          okButtonProps: { danger: true },
                          onOk: () => remove.mutateAsync(s.id),
                        })
                      }
                      className="grid size-10 place-items-center rounded-lg text-red-700 hover:bg-red-50"
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No sheets
          {keeper
            ? ' yet. Start one for each pot of money: "Kitchen fees", "Mercury sales"…'
            : " you can see."}
        </p>
      )}

      <Modal
        open={open}
        title="New sheet"
        okText="Start sheet"
        confirmLoading={create.isPending}
        okButtonProps={{
          disabled: !form.name.trim() || !openingOk || !quantityOk,
        }}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          await create.mutateAsync(form);
          setOpen(false);
        }}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Name</span>
            <Input
              autoFocus
              size="large"
              maxLength={80}
              placeholder={
                form.kind === "people"
                  ? "For example: Welfare savings"
                  : form.kind === "quantity"
                    ? "For example: Mercury"
                    : "For example: Kitchen fees"
              }
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <div>
            <span className="mb-1 block text-sm font-medium">
              What it keeps
            </span>
            <Segmented
              block
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: v as SheetKind })}
              options={[
                { label: "Money", value: "money" },
                { label: "Savings per person", value: "people" },
                { label: "Money and quantity", value: "quantity" },
              ]}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {form.kind === "people"
                ? "One balance for each person, and the total. You add the people after."
                : form.kind === "quantity"
                  ? "Each entry can also carry an amount of something, like kg of mercury. The sheet shows what is in hand as well as the cash."
                  : "One running balance in cedis: kitchen fees, a welfare pot."}
            </p>
          </div>
          {form.kind === "quantity" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Unit</span>
                <Input
                  size="large"
                  maxLength={12}
                  placeholder="kg"
                  value={form.unit}
                  status={form.unit.trim() ? undefined : "error"}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  In hand now{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </span>
                <Input
                  size="large"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.openingQuantity}
                  onChange={(e) =>
                    setForm({ ...form, openingQuantity: e.target.value })
                  }
                />
              </label>
            </div>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Branch{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </span>
            <Select
              allowClear
              size="large"
              className="w-full"
              placeholder="Not tied to a branch"
              value={form.branchId}
              onChange={(v) => setForm({ ...form, branchId: v })}
              options={(branches.data ?? []).map((b) => ({
                value: b.id,
                label: b.name,
              }))}
            />
          </label>
          {form.kind !== "people" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Opening balance{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </span>
                <Input
                  size="large"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.opening}
                  status={openingOk ? undefined : "error"}
                  onChange={(e) =>
                    setForm({ ...form, opening: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">As of</span>
                <input
                  type="date"
                  value={form.openingDate}
                  onChange={(e) =>
                    setForm({ ...form, openingDate: e.target.value })
                  }
                  className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                />
              </label>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {form.kind === "people"
              ? "A savings sheet starts at zero. Bring each person's balance over as their first entry."
              : "Carrying over a notebook? Put its balance here, so the sheet starts where the notebook ends."}
          </p>
        </div>
      </Modal>
      <Modal
        open={!!renaming}
        title="Rename the sheet"
        okText="Save"
        okButtonProps={{ disabled: !renaming?.name.trim() }}
        onCancel={() => setRenaming(null)}
        onOk={async () => {
          if (renaming)
            await update.mutateAsync({
              id: renaming.id,
              name: renaming.name.trim(),
            });
          setRenaming(null);
        }}
      >
        <Input
          autoFocus
          size="large"
          maxLength={80}
          value={renaming?.name ?? ""}
          onChange={(e) =>
            setRenaming((r) => (r ? { ...r, name: e.target.value } : r))
          }
        />
      </Modal>
    </section>
  );
}

function PeopleTab({ group: g }: { group: Group }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id ?? "");
  const keeper = g.myRole === "keeper";
  const online = useConnectivity((s) => s.online);
  const colleagues = useColleagues(keeper);
  const branches = useAllBranches();
  const [person, setPerson] = useState<string>();
  const [role, setRole] = useState<GroupRole>("writer");
  const [branch, setBranch] = useState<string>();
  const [branchRole, setBranchRole] = useState<"writer" | "reader">("reader");
  const verb = useGsMutation(
    (v: {
      verb:
        | "members"
        | "members-remove"
        | "members-back"
        | "rules"
        | "rules-remove";
      data: Record<string, unknown>;
    }) => gsApi.groupVerb(g.id, v.verb, v.data),
  );
  const leave = useGsMutation(() => gsApi.leave(g.id), "You left the group");
  const inGroup = new Set(g.members.map((m) => m.id));

  return (
    <section className="space-y-4">
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {g.members.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="min-w-0 flex-1 basis-40">
              <span className="block truncate font-semibold">
                {m.displayName}
                {m.id === me ? " (you)" : ""}
              </span>
              <span className="block text-xs text-muted-foreground">
                {m.how === "branch" ? "Through a branch" : "Added by name"}
              </span>
            </span>
            {keeper && m.id !== me ? (
              <>
                <Select
                  size="middle"
                  className="w-36"
                  value={m.role}
                  disabled={!online || verb.isPending}
                  onChange={(r) =>
                    verb.mutate({
                      verb: "members",
                      data: { userId: m.id, role: r },
                    })
                  }
                  options={[
                    { value: "keeper", label: "Keeper" },
                    { value: "writer", label: "Writer" },
                    { value: "reader", label: "Reader" },
                  ]}
                />
                <button
                  type="button"
                  title="Take out of the group"
                  aria-label={`Take ${m.displayName} out`}
                  disabled={!online}
                  onClick={() =>
                    Modal.confirm({
                      title: `Take ${m.displayName} out of ${g.name}?`,
                      content:
                        m.how === "branch"
                          ? "They are in through a branch. They will be left out of it, and can be let back in later."
                          : "They stop seeing the group at once. What they wrote stays.",
                      okText: "Take out",
                      okButtonProps: { danger: true },
                      onOk: () =>
                        verb.mutateAsync({
                          verb: "members-remove",
                          data: { userId: m.id },
                        }),
                    })
                  }
                  className="grid size-10 place-items-center rounded-lg text-red-700 hover:bg-red-50"
                >
                  <UserMinusIcon className="size-4" aria-hidden />
                </button>
              </>
            ) : (
              <Chip tone={m.role === "keeper" ? "amber" : "grey"}>
                {roleLabel(m.role)}
              </Chip>
            )}
          </li>
        ))}
      </ul>

      {keeper ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <h3 className="font-semibold">Add someone by name</h3>
            <Select
              showSearch
              size="large"
              className="w-full"
              placeholder="Choose a person"
              optionFilterProp="label"
              value={person}
              onChange={setPerson}
              loading={colleagues.isLoading}
              options={(colleagues.data ?? [])
                .filter((c) => !inGroup.has(c.id))
                .map((c) => ({ value: c.id, label: c.displayName }))}
            />
            <Select
              size="large"
              className="w-full"
              value={role}
              onChange={setRole}
              options={roleOptions}
            />
            <button
              type="button"
              disabled={!person || !online || verb.isPending}
              onClick={async () => {
                await verb.mutateAsync({
                  verb: "members",
                  data: { userId: person, role },
                });
                setPerson(undefined);
              }}
              className={`${btn} bg-navy text-white disabled:opacity-50`}
            >
              <UserPlusIcon className="size-4" aria-hidden />
              Add
            </button>
          </div>
          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <h3 className="font-semibold">Everyone at a branch</h3>
            <p className="text-xs text-muted-foreground">
              People posted to the branch join on their own; those who leave it
              drop out. Keepers are always chosen by name.
            </p>
            {g.rules.length ? (
              <ul className="space-y-1.5">
                {g.rules.map((r) => (
                  <li
                    key={r.branchId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      Everyone at <b>{r.branchName}</b>
                    </span>
                    <Select
                      size="small"
                      className="w-28"
                      value={r.role}
                      disabled={!online}
                      onChange={(v) =>
                        verb.mutate({
                          verb: "rules",
                          data: { branchId: r.branchId, role: v },
                        })
                      }
                      options={[
                        { value: "writer", label: "Writers" },
                        { value: "reader", label: "Readers" },
                      ]}
                    />
                    <button
                      type="button"
                      aria-label={`Stop adding everyone at ${r.branchName}`}
                      disabled={!online}
                      onClick={() =>
                        verb.mutate({
                          verb: "rules-remove",
                          data: { branchId: r.branchId },
                        })
                      }
                      className="grid size-8 place-items-center rounded-lg text-red-700 hover:bg-red-50"
                    >
                      <Trash2Icon className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Select
                size="large"
                className="min-w-40 flex-1"
                placeholder="Choose a branch"
                value={branch}
                onChange={setBranch}
                options={(branches.data ?? [])
                  .filter((b) => !g.rules.some((r) => r.branchId === b.id))
                  .map((b) => ({ value: b.id, label: b.name }))}
              />
              <Select
                size="large"
                className="w-32"
                value={branchRole}
                onChange={setBranchRole}
                options={[
                  { value: "reader", label: "as readers" },
                  { value: "writer", label: "as writers" },
                ]}
              />
            </div>
            <button
              type="button"
              disabled={!branch || !online || verb.isPending}
              onClick={async () => {
                await verb.mutateAsync({
                  verb: "rules",
                  data: { branchId: branch, role: branchRole },
                });
                setBranch(undefined);
              }}
              className={`${btn} bg-navy text-white disabled:opacity-50`}
            >
              <PlusIcon className="size-4" aria-hidden />
              Add the branch
            </button>
          </div>
        </div>
      ) : null}

      {keeper && g.leftOut.length ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <h3 className="font-semibold">Left out of a branch</h3>
          {g.leftOut.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{p.displayName}</span>
              <button
                type="button"
                disabled={!online}
                onClick={() =>
                  verb.mutate({ verb: "members-back", data: { userId: p.id } })
                }
                className={`${btn} border border-border hover:bg-muted`}
              >
                Let back in
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        disabled={!online || leave.isPending}
        onClick={() =>
          Modal.confirm({
            title: `Leave ${g.name}?`,
            content:
              "You stop seeing its sheets at once. What you wrote stays. A keeper can add you again.",
            okText: "Leave",
            okButtonProps: { danger: true },
            onOk: async () => {
              await leave.mutateAsync();
              navigate(paths.groupSheets.href);
            },
          })
        }
        className={`${btn} text-red-700 hover:bg-red-50 disabled:opacity-50`}
      >
        <DoorOpenIcon className="size-4" aria-hidden />
        Leave this group
      </button>
    </section>
  );
}

const accessOptions = [
  { value: "", label: "Role decides" },
  { value: "write", label: "See and write" },
  { value: "read", label: "See only" },
  { value: "none", label: "Not see" },
];

/** People against sheets: keepers narrow what someone (or everyone) may do on each sheet. Narrowing never makes a reader a writer. */
function AccessTab({ group: g }: { group: Group }) {
  const online = useConnectivity((s) => s.online);
  const set = useGsMutation(
    (v: { sheetId: string; userId: string | null; access: Access | null }) =>
      gsApi.setAccess(v.sheetId, v.userId, v.access),
  );
  const lookup = useMemo(
    () =>
      new Map(
        g.access.map((a) => [`${a.sheetId}:${a.userId ?? "*"}`, a.access]),
      ),
    [g.access],
  );
  const rows = [
    {
      id: null as string | null,
      displayName: "Everyone",
      role: null as GroupRole | null,
    },
    ...g.members
      .filter((m) => m.role !== "keeper")
      .map((m) => ({
        id: m.id as string | null,
        displayName: m.displayName,
        role: m.role as GroupRole | null,
      })),
  ];
  if (!g.sheets.length)
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Start a sheet first.
      </p>
    );
  return (
    <section className="space-y-2">
      <p className="text-sm text-muted-foreground">
        By default a writer sees and writes every sheet and a reader sees every
        sheet. Narrow it here for one person or for everyone. Keepers always see
        everything.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="p-3 font-medium text-muted-foreground">Person</th>
              {g.sheets.map((s) => (
                <th key={s.id} className="p-3 font-semibold">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id ?? "*"}
                className="border-b border-border last:border-0"
              >
                <td className="p-3">
                  <span className="font-medium">{r.displayName}</span>
                  {r.role ? (
                    <span className="block text-xs text-muted-foreground">
                      {roleLabel(r.role)}
                    </span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">
                      unless set for a person
                    </span>
                  )}
                </td>
                {g.sheets.map((s) => (
                  <td key={s.id} className="p-2">
                    <Select
                      size="small"
                      className="w-36"
                      disabled={!online || set.isPending}
                      value={lookup.get(`${s.id}:${r.id ?? "*"}`) ?? ""}
                      onChange={(v) =>
                        set.mutate({
                          sheetId: s.id,
                          userId: r.id,
                          access: (v || null) as Access | null,
                        })
                      }
                      options={accessOptions.filter(
                        (o) => !(r.role === "reader" && o.value === "write"),
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivityTab({ group: g }: { group: Group }) {
  const q = useGsActivity(g.id, true);
  const names = useMemo(
    () => new Map(g.sheets.map((s) => [s.id, s.name])),
    [g.sheets],
  );
  if (q.isLoading)
    return <div className="h-32 animate-pulse rounded-2xl bg-muted" />;
  if (q.error)
    return <p className="text-sm text-red-700">{errorMessage(q.error)}</p>;
  return (
    <section className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Everything that changed the group, and every entry taken back. Only the
        group's members see this.
      </p>
      <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {(q.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-3 px-4 py-2.5 text-sm">
            <span className="tnum w-32 shrink-0 text-xs text-muted-foreground">
              {new Date(a.at).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="min-w-0 flex-1">
              {activityText(a, (sid) => names.get(sid))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
