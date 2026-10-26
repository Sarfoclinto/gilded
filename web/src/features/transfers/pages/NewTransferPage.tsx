import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Checkbox, Segmented } from "antd";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { cedis } from "@/features/calculator/format";
import { SelectField } from "@/shared/ui/SelectField";
import { PageHeader } from "@/shared/ui/PageHeader";
import { TextField } from "@/shared/ui/TextField";
import {
  CollectorFields,
  cleanCollector,
  collectorReady,
} from "../CollectorFields";
import { useCreateTransfer, useTransferableItems } from "../api";
import { methodLabel, purposeLabel } from "../labels";
import type { CollectorInput } from "../schemas";

export default function NewTransferPage() {
  const navigate = useNavigate();
  const origin = useAuth((s) => s.activeBranchId);
  const names = useBranchNames();
  const create = useCreateTransfer();
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<"goods" | "cash">("goods");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("stock_collection");
  const [method, setMethod] = useState("staff_travelling");
  const [purposeNote, setPurposeNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [setNow, setSetNow] = useState(false);
  const [collector, setCollector] = useState<CollectorInput>({ type: "staff" });
  const items = useTransferableItems(origin, kind === "goods");
  const rows = items.data ?? [];
  const total = rows
    .filter((i) => picked.includes(i.itemId))
    .reduce((s, i) => s + Number(i.value), 0);
  const others = Object.entries(names).filter(([bid]) => bid !== origin);
  const ok =
    !!origin &&
    !!destination &&
    (kind === "cash" || picked.length > 0) &&
    (!setNow || collectorReady(collector)) &&
    !create.isPending;

  function save() {
    if (!origin || !ok) return;
    create.mutate(
      {
        id,
        kind,
        originBranchId: origin,
        destinationBranchId: destination,
        purpose,
        method,
        ...(purposeNote.trim() ? { purposeNote: purposeNote.trim() } : {}),
        ...(kind === "goods" ? { itemIds: picked } : {}),
        ...(setNow ? { collector: cleanCollector(collector) } : {}),
      },
      { onSuccess: (t) => navigate(paths.transfers.detail.to(t.id)) },
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-8">
      <Link
        to={paths.transfers.list.href}
        className="text-sm text-muted-foreground underline"
      >
        ← Transfers
      </Link>
      <PageHeader
        title="New transfer"
        subtitle={
          origin
            ? `From ${names[origin] ?? "this branch"}. Nothing leaves until you hand it to the collector.`
            : undefined
        }
      />
      <Segmented
        block
        value={kind}
        onChange={(v) => {
          setKind(v as "goods" | "cash");
          setPurpose(v === "goods" ? "stock_collection" : "restock_funding");
        }}
        options={[
          { label: "Gold", value: "goods" },
          { label: "Cash", value: "cash" },
        ]}
      />
      <SelectField
        label="Going to"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
      >
        <option value="">Choose a branch…</option>
        {others.map(([bid, name]) => (
          <option key={bid} value={bid}>
            {name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Why"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        >
          {Object.entries(purposeLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="How it travels"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {Object.entries(methodLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField
        label="Note (optional)"
        value={purposeNote}
        onChange={(e) => setPurposeNote(e.target.value)}
      />

      {kind === "goods" ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Which gold</h2>
          {rows.length === 0 && !items.isLoading ? (
            <Alert
              type="info"
              showIcon
              title="There is no gold at this branch to send."
            />
          ) : null}
          <ul className="max-h-96 divide-y divide-border overflow-auto rounded-lg border border-border">
            {rows.map((i) => (
              <li key={i.itemId} className="px-3 py-2">
                <Checkbox
                  checked={picked.includes(i.itemId)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...picked, i.itemId]
                        : picked.filter((x) => x !== i.itemId),
                    )
                  }
                >
                  <span className="font-medium">{i.customerName}</span> ·{" "}
                  {i.label}
                  <span className="tnum block text-xs text-muted-foreground">
                    {i.reference} · top {i.top} g · down {i.down} g ·{" "}
                    {cedis(Number(i.value))}
                  </span>
                </Checkbox>
              </li>
            ))}
          </ul>
          {picked.length ? (
            <p className="tnum text-sm text-muted-foreground">
              {picked.length} selected · worth {cedis(total)}
            </p>
          ) : null}
        </section>
      ) : (
        <Alert
          type="info"
          showIcon
          title="You count the notes when you hand the cash over."
        />
      )}

      <section className="space-y-3">
        <Checkbox
          checked={setNow}
          onChange={(e) => setSetNow(e.target.checked)}
        >
          I know who is carrying it
        </Checkbox>
        {setNow ? (
          <CollectorFields value={collector} onChange={setCollector} />
        ) : (
          <p className="text-xs text-muted-foreground">
            You can add the collector later, before handing over.
          </p>
        )}
      </section>

      {create.error ? (
        <Alert type="error" showIcon title={create.error.message} />
      ) : null}
      <button
        type="button"
        disabled={!ok}
        onClick={save}
        className="min-h-11 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {create.isPending ? "Saving…" : "Save draft"}
      </button>
    </div>
  );
}
