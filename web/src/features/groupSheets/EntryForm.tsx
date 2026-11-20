import { useRef, useState } from "react";
import { Input, Modal, Segmented, Select, Switch } from "antd";
import { CameraIcon, XIcon } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { usePhotoQueue } from "@/features/photos/PhotoProvider";
import { preparePhoto } from "@/features/photos/process";
import type { Sheet } from "./api";
import { useGsOutbox } from "./local";
import { cleanAmount, cleanQuantity, money, qty } from "./model";

/** What the form needs to know about the sheet: the list on the main page and a sheet's own page both have it. */
export type EntrySheet = Pick<Sheet, "id" | "name" | "kind" | "unit" | "people" | "balance" | "stock"> & { today?: string };

const todayHere = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * + Add or − Take out, on any kind of sheet. The entry goes to this device first (sent when there is a connection), and so do its receipt
 * photos: they follow the entry once it has reached the server. Savings sheets ask whose savings it is; quantity sheets take a quantity
 * that came in or went out, with or without money.
 */
export function EntryModal({
  sheet,
  balance,
  stock,
  direction: start,
  personId: startPerson,
  onClose,
}: {
  sheet: EntrySheet;
  balance?: string;
  stock?: string | null;
  direction: "in" | "out";
  personId?: string;
  onClose: () => void;
}) {
  const user = useAuth((s) => s.user);
  const queue = usePhotoQueue();
  const quantitySheet = sheet.kind === "quantity";
  const peopleSheet = sheet.kind === "people";
  const today = sheet.today ?? todayHere();
  const [direction, setDirection] = useState(start);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [dayTotal, setDayTotal] = useState(false);
  const [personId, setPersonId] = useState<string | undefined>(startPerson);
  const [quantity, setQuantity] = useState("");
  const [qtyDirection, setQtyDirection] = useState<"in" | "out">(start === "in" ? "out" : "in");
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const cleanA = amount.trim() ? cleanAmount(amount) : null;
  const cleanQ = quantity.trim() ? cleanQuantity(quantity) : null;
  const amountBad = !!amount.trim() && !cleanA;
  const qtyBad = !!quantity.trim() && !cleanQ;
  const hasSomething = quantitySheet ? !!cleanA || !!cleanQ : !!cleanA;
  const ok = hasSomething && !amountBad && !qtyBad && !!date && (!peopleSheet || !!personId);
  const personBalance = peopleSheet ? sheet.people?.find((p) => p.id === personId)?.balance : undefined;
  const base = peopleSheet ? personBalance : (balance ?? sheet.balance);
  const after = cleanA && base !== undefined ? Number(base) + (direction === "out" ? -1 : 1) * Number(cleanA) : null;
  const stockAfter = cleanQ && quantitySheet ? Number(stock ?? sheet.stock ?? 0) + (qtyDirection === "out" ? -1 : 1) * Number(cleanQ) : null;

  const save = async () => {
    if (!ok || saving) return;
    setSaving(true);
    const id = crypto.randomUUID();
    useGsOutbox.getState().add({
      id,
      sheetId: sheet.id,
      direction: cleanA ? direction : undefined,
      amount: cleanA ?? undefined,
      personId: peopleSheet ? personId : undefined,
      quantity: cleanQ ?? undefined,
      qtyDirection: cleanQ ? qtyDirection : undefined,
      note: note.trim() || undefined,
      moneyDate: date,
      dayTotal: direction === "in" && !!cleanA && dayTotal,
      writtenAt: new Date().toISOString(),
    });
    // receipt photos wait on this device and go once the entry is on the server (the queue retries a "not there yet")
    if (queue && user) {
      for (const f of photos) {
        try {
          const p = await preparePhoto(f, { source: "library", name: f.name });
          await queue.add(p, { entityType: "gsentry", entityId: id, slot: "receipt" }, user.id);
        } catch {
          /* a picture that cannot be read is skipped; the entry is kept */
        }
      }
    }
    onClose();
  };

  return (
    <Modal
      open
      title={sheet.name}
      okText={direction === "in" ? "Add" : "Take out"}
      okButtonProps={{ disabled: !ok, loading: saving }}
      onOk={() => void save()}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="space-y-4">
        {peopleSheet ? (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Whose savings</span>
            <Select
              showSearch
              size="large"
              className="w-full"
              placeholder={sheet.people?.length ? "Choose a person" : "A keeper adds people to this sheet first"}
              optionFilterProp="label"
              value={personId}
              onChange={setPersonId}
              options={(sheet.people ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${money(p.balance)}` }))}
            />
          </label>
        ) : null}

        <Segmented
          block
          size="large"
          value={direction}
          onChange={(v) => {
            setDirection(v as "in" | "out");
            if (!quantity.trim()) setQtyDirection(v === "in" ? "out" : "in");
          }}
          options={[
            { label: "+ Add money", value: "in" },
            { label: "− Take out money", value: "out" },
          ]}
        />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Amount (GHS){quantitySheet ? <span className="font-normal text-muted-foreground"> (leave empty if no money moved)</span> : null}
          </span>
          <Input
            autoFocus={!peopleSheet}
            size="large"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onPressEnter={() => void save()}
            status={amountBad ? "error" : undefined}
            className="tnum"
          />
          {amountBad ? <span className="mt-1 block text-xs text-red-700">Type an amount like 150 or 12.50.</span> : null}
        </label>

        {quantitySheet ? (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Quantity ({sheet.unit})</span>
              <Segmented
                size="small"
                value={qtyDirection}
                onChange={(v) => setQtyDirection(v as "in" | "out")}
                options={[
                  { label: "Came in", value: "in" },
                  { label: "Went out", value: "out" },
                ]}
              />
            </div>
            <Input
              size="large"
              inputMode="decimal"
              placeholder={`0 ${sheet.unit ?? ""}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              status={qtyBad ? "error" : undefined}
              className="tnum"
            />
            {qtyBad ? <span className="block text-xs text-red-700">Type a quantity like 0.5 (up to 3 decimals).</span> : null}
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <Input
            size="large"
            maxLength={140}
            showCount
            placeholder={quantitySheet ? "For example: sold 0.5 kg to Kwame" : direction === "in" ? "For example: Ama paid, week 47" : "For example: gas refill"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Date it happened</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-10 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </label>
          {direction === "in" && !peopleSheet ? (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <Switch checked={dayTotal} onChange={setDayTotal} />
              Day total
            </label>
          ) : null}
        </div>

        <div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
              setPhotos((p) => [...p, ...picked].slice(0, 5));
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={photos.length >= 5}
              onClick={() => file.current?.click()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <CameraIcon className="size-4" aria-hidden />
              Receipt photo
            </button>
            {photos.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                Photo {i + 1}
                <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((p) => p.filter((_, k) => k !== i))} className="grid size-5 place-items-center rounded-full hover:bg-background">
                  <XIcon className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
          {photos.length ? <p className="mt-1 text-xs text-muted-foreground">Only people who can see this sheet will see the photo.</p> : null}
        </div>

        {after !== null || stockAfter !== null ? (
          <div className="tnum space-y-1 rounded-lg bg-muted/60 p-2.5 text-sm">
            {after !== null ? (
              <p className={after < 0 ? "text-red-800 dark:text-red-300" : ""}>
                {peopleSheet ? "Their savings will be" : "The balance will be"} <b>{money(after)}</b>
                {after < 0 ? ". That is below zero: check the amount, or save it if that is what happened." : "."}
              </p>
            ) : null}
            {stockAfter !== null ? (
              <p className={stockAfter < 0 ? "text-red-800 dark:text-red-300" : ""}>
                In hand will be <b>{qty(stockAfter, sheet.unit)}</b>
                {stockAfter < 0 ? ". That is below zero: check the quantity." : "."}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}