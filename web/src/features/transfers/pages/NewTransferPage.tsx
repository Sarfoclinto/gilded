import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Checkbox } from "antd";
import { BanknoteIcon, GemIcon } from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { cedis } from "@/features/calculator/format";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import {
  CollectorFields,
  cleanCollector,
  collectorReady,
} from "../CollectorFields";
import { GoldPicker } from "../GoldPicker";
import { useCreateTransfer, useTransferableItems } from "../api";
import { methodLabel, purposeLabel } from "../labels";
import { pickedTotals } from "../model";
import type { CollectorInput } from "../schemas";

type Kind = "goods" | "cash";

function KindCard({
  active,
  icon,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition ${active ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-border bg-card hover:bg-muted"}`}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
        {icon}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

export default function NewTransferPage() {
  const navigate = useNavigate();
  const origin = useAuth((s) => s.activeBranchId);
  const names = useBranchNames();
  const create = useCreateTransfer();
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<Kind>("goods");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("stock_collection");
  const [method, setMethod] = useState("staff_travelling");
  const [purposeNote, setPurposeNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [setNow, setSetNow] = useState(false);
  const [collector, setCollector] = useState<CollectorInput>({ type: "staff" });
  const items = useTransferableItems(origin, kind === "goods");
  const rows = items.data ?? [];
  const totals = pickedTotals(rows, picked);
  const others = Object.entries(names).filter(([bid]) => bid !== origin);
  const ok =
    !!origin &&
    !!destination &&
    (kind === "cash" || picked.length > 0) &&
    (!setNow || collectorReady(collector)) &&
    !create.isPending;
  const missing = !destination
    ? "Choose where it is going."
    : kind === "goods" && picked.length === 0
      ? "Tick the gold you are sending."
      : setNow && !collectorReady(collector)
        ? "Fill in who is carrying it."
        : "";

  function pickKind(k: Kind) {
    setKind(k);
    setPicked([]);
    setPurpose(k === "goods" ? "stock_collection" : "restock_funding");
  }

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
    <div className="mx-auto max-w-3xl space-y-5 p-3 pb-0 sm:p-4 lg:p-6">
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

      <section className="space-y-2" aria-label="What are you sending">
        <h2 className="text-sm font-semibold">1 · What are you sending?</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <KindCard
            active={kind === "goods"}
            icon={<GemIcon className="size-5" />}
            title="Gold"
            hint="Pieces bought here and still in stock"
            onClick={() => pickKind("goods")}
          />
          <KindCard
            active={kind === "cash"}
            icon={<BanknoteIcon className="size-5" />}
            title="Cash"
            hint="Money for another branch's drawer"
            onClick={() => pickKind("cash")}
          />
        </div>
      </section>

      <section className="space-y-3" aria-label="Where to">
        <h2 className="text-sm font-semibold">2 · Where is it going?</h2>
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
      </section>

      <section className="space-y-2" aria-label="What goes">
        <h2 className="text-sm font-semibold">
          3 · {kind === "goods" ? "Which gold?" : "The cash"}
        </h2>
        {kind === "goods" ? (
          <GoldPicker
            rows={rows}
            picked={picked}
            onChange={setPicked}
            loading={items.isLoading}
          />
        ) : (
          <Alert
            type="info"
            showIcon
            title="You count the notes when you hand the cash over."
          />
        )}
      </section>

      <section className="space-y-3" aria-label="Who carries it">
        <h2 className="text-sm font-semibold">4 · Who is carrying it?</h2>
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

      <div className="sticky bottom-0 z-20 -mx-3 border-t border-border bg-card/95 p-3 backdrop-blur sm:-mx-4 lg:-mx-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            {kind === "goods" && picked.length ? (
              <span className="tnum font-semibold">
                {picked.length} piece{picked.length === 1 ? "" : "s"} ·{" "}
                {cedis(totals.value)}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {missing || "Ready to save as a draft."}
              </span>
            )}
          </div>
          <Button disabled={!ok} onClick={save}>
            {create.isPending ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}
