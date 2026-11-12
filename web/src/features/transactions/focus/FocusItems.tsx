import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calculate } from "@gold/core";
import { cedis, percent } from "@/features/calculator/format";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePersonalSettings } from "@/features/settings/personal";
import { decimalOnly } from "@/shared/lib/numbers";
import { applyKey, nextField, type Field, type PadKey } from "./keypad";
import { NumberPad } from "./NumberPad";

export interface FocusItem {
  id: string;
  top: string;
  down: string;
  price: string;
  priceTouched: boolean;
}
type Result = ReturnType<typeof calculate>;

const FIELD_LABEL: Record<Field, string> = {
  top: "Top weight",
  down: "Down weight",
  price: "Price per pound",
};

function Tile({
  label,
  unit,
  value,
  placeholder,
  active,
  selected,
  error,
  hint,
  keypad,
  inputRef,
  onChange,
  onFocus,
}: {
  label: string;
  unit: string;
  value: string;
  placeholder: string;
  active: boolean;
  selected: boolean;
  error?: string;
  hint?: string;
  keypad: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (v: string) => void;
  onFocus: () => void;
}) {
  return (
    <label
      className={`block cursor-text rounded-2xl bg-card p-3.5 shadow-sm ring-2 transition ${error ? "ring-red-500/70" : active ? "ring-gold" : "ring-transparent"}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="mt-2 flex items-baseline justify-between gap-2">
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          // With the on-screen keypad the phone's own keyboard stays closed; the field is only a place to see what was typed.
          inputMode={keypad ? "none" : "decimal"}
          readOnly={keypad}
          onChange={(e) => onChange(decimalOnly(e.target.value))}
          onFocus={onFocus}
          aria-label={label}
          aria-invalid={!!error}
          autoComplete="off"
          className={`tnum min-w-0 flex-1 rounded bg-transparent text-3xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40 ${selected ? "bg-gold/30" : ""}`}
        />
        <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>
      </span>
      {error ? (
        <span
          role="alert"
          className="mt-1 block text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

function ResultTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3.5">
      <p className="text-sm text-white/70">{label}</p>
      <p className="tnum mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

/**
 * The "Focus" way of entering gold: one yellow card to type in (top, down, price in large type) and one dark card with the result
 * (pounds, density, karat, purity and the amount, big). On a touch screen the numbers are typed on a big on-screen pad that never hides
 * the field. It edits the same items the Classic form does, so switching between them loses nothing.
 */
export function FocusItems({
  items,
  results,
  todayPrice,
  onPatch,
  onRemove,
  headerAction,
}: {
  items: FocusItem[];
  results: Result[];
  todayPrice?: string;
  onPatch: (id: string, change: Partial<FocusItem>) => void;
  onRemove: (id: string) => void;
  /** Something small (e.g. the Classic | Focus switch) shown at the right of the first Input card's header, to save a row. */
  headerAction?: ReactNode;
}) {
  const keypadOn = usePersonalSettings((s) => s.keypad);
  const coarse = useMediaQuery("(pointer: coarse)");
  const keypad = keypadOn && coarse;
  const [active, setActive] = useState<{ id: string; field: Field } | null>(
    null,
  );
  // A field that already holds something (today's price, a typed weight) is replaced by the first key pressed, as on a calculator.
  const [fresh, setFresh] = useState(false);
  const refs = useRef(new Map<string, HTMLInputElement>());
  const key = (id: string, f: Field) => `${id}:${f}`;
  const ids = useMemo(() => items.map((i) => i.id), [items]);

  const focus = (a: { id: string; field: Field }) => {
    setActive(a);
    setFresh(true);
    requestAnimationFrame(() => {
      const el = refs.current.get(key(a.id, a.field));
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  const current = active ? items.find((i) => i.id === active.id) : undefined;

  // A field that goes away (an item removed) cannot stay active.
  useEffect(() => {
    if (active && !items.some((i) => i.id === active.id)) setActive(null);
  }, [items, active]);

  const onKey = (k: PadKey) => {
    if (!active || !current) return;
    setFresh(false);
    onPatch(current.id, {
      [active.field]: applyKey(fresh ? "" : current[active.field], k),
      ...(active.field === "price" ? { priceTouched: true } : {}),
    });
  };
  const next = active ? nextField(ids, active) : null;
  const done = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    setActive(null);
  };
  const activeResult = active ? results[ids.indexOf(active.id)] : undefined;

  return (
    <div className="space-y-6">
      {items.map((it, idx) => {
        const r = results[idx]!;
        const err = (f: Field) => r.errors.find((e) => e.field === f)?.message;
        const isActive = (f: Field) =>
          active?.id === it.id && active.field === f;
        const tile = (
          f: Field,
          unit: string,
          placeholder: string,
          hint?: string,
        ) => (
          <Tile
            label={FIELD_LABEL[f]}
            unit={unit}
            value={it[f]}
            placeholder={placeholder}
            active={isActive(f)}
            selected={keypad && fresh && isActive(f) && it[f] !== ""}
            error={err(f)}
            hint={hint}
            keypad={keypad}
            inputRef={(el) => {
              if (el) refs.current.set(key(it.id, f), el);
              else refs.current.delete(key(it.id, f));
            }}
            onChange={(v) =>
              onPatch(it.id, {
                [f]: v,
                ...(f === "price" ? { priceTouched: true } : {}),
              })
            }
            onFocus={() => {
              if (!(active?.id === it.id && active.field === f)) setFresh(true);
              setActive({ id: it.id, field: f });
            }}
          />
        );
        return (
          <section
            key={it.id}
            aria-label={`Item ${idx + 1}`}
            className="space-y-3"
          >
            {items.length > 1 ? (
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Item {idx + 1}</h3>
                <button
                  type="button"
                  className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => onRemove(it.id)}
                >
                  Remove
                </button>
              </div>
            ) : null}
            <div className="grid gap-3 2xl:grid-cols-2 2xl:items-stretch">
              <div className="rounded-3xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-700/40 dark:bg-amber-950/30">
                <p className="mb-2 flex items-center gap-2 px-1 text-sm">
                  <span className="size-2.5 rounded-full bg-gold" aria-hidden />
                  <strong className="text-base">Input</strong>
                  <span className="text-amber-800 dark:text-amber-200 hidden sm:inline">
                    details of the gold
                  </span>
                  {idx === 0 && headerAction ? (
                    <span className="ml-auto">{headerAction}</span>
                  ) : null}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {tile("top", "grams", "0")}
                  {tile("down", "grams", "0")}
                  <div className="col-span-2">
                    {tile(
                      "price",
                      "GHS",
                      "0",
                      it.priceTouched && todayPrice
                        ? `Changed by you · today is ${todayPrice}`
                        : undefined,
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-3xl bg-navy p-3 text-white">
                <p className="mb-2 flex items-center gap-2 px-1 text-sm">
                  <span className="size-2.5 rounded-full bg-gold" aria-hidden />
                  <strong className="text-base">Results</strong>
                  <span className="text-white/70">update as you type</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <ResultTile label="Pounds" value={r.pounds ?? "—"} />
                  <ResultTile label="Density" value={r.density ?? "—"} />
                  <ResultTile label="Karat used" value={r.karat ?? "—"} />
                  <ResultTile
                    label="Purity"
                    value={r.purity ? percent(r.purity) : "—"}
                  />
                </div>
                <div className="mt-3 rounded-2xl bg-white p-4 text-navy">
                  <p className="text-sm text-navy/70">
                    Amount to be paid to the seller
                  </p>
                  <p className="tnum mt-1 break-words text-3xl font-extrabold tracking-tight sm:text-4xl">
                    {r.amount ? cedis(r.amount) : "—"}
                  </p>
                  {r.netWeight ? (
                    <p className="tnum mt-1 text-xs text-navy/60">
                      {r.netWeight} g net
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            {r.warnings.map((w) => (
              <p
                key={w.code}
                role="alert"
                className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
              >
                {w.message}
              </p>
            ))}
          </section>
        );
      })}

      {keypad && active ? (
        <>
          {/* Room under the form so the field being typed in can always be scrolled above the pad. */}
          <div aria-hidden style={{ height: 340 }} />
          <NumberPad
            title={`${FIELD_LABEL[active.field]}${items.length > 1 ? ` · item ${ids.indexOf(active.id) + 1}` : ""}${activeResult?.amount ? " · amount to be paid" : ""}`}
            subtitle={
              activeResult?.amount ? cedis(activeResult.amount) : undefined
            }
            nextLabel="Next"
            onKey={onKey}
            onNext={() => (next ? focus(next) : done())}
            onDone={done}
          />
        </>
      ) : null}
    </div>
  );
}
