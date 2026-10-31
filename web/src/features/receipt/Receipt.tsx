import { useMemo } from "react";
import { cedis } from "@/features/calculator/format";
import { goldTotals, payoutRuleText } from "@/features/transactions/receipt";
import {
  paymentMethodText,
  type TransactionView,
} from "@/features/transactions/view";
import { grams, trimNumber } from "@/shared/lib/numbers";
import { qrMatrix, qrPath, receiptPayload } from "./qr";
import { PAPER, type ReceiptSettings } from "./settings";

const stamp = (iso: string) => {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-GH", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" }),
  };
};

function Qr({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const m = qrMatrix(text);
    return { size: m.size, path: qrPath(m) };
  }, [text]);
  return (
    <svg
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Receipt code"
      className="size-full"
    >
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}

const Rule = ({ strong = false }: { strong?: boolean }) => (
  <div
    aria-hidden
    className={`my-2.5 border-t ${strong ? "border-solid border-neutral-800" : "border-dashed border-neutral-400"}`}
  />
);

function Row({ k, v, bold = false }: { k: string; v: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${bold ? "font-semibold" : ""}`}
    >
      <span className="text-neutral-600">{k}</span>
      <span className="shrink-0 whitespace-nowrap text-right tabular-nums">
        {v}
      </span>
    </div>
  );
}

/**
 * The customer's copy. Drawn in millimetres so a roll printer and a plain A4 sheet both come out right, and in plain
 * black on white so it stays sharp on a thermal head. It reads the same purchase view as the screens, so a purchase
 * still waiting to be sent can be printed too (its number is added when it reaches the server).
 */
export function Receipt({
  t,
  settings,
  branchName,
  servedBy,
}: {
  t: TransactionView;
  settings: ReceiptSettings;
  branchName?: string;
  servedBy?: string;
}) {
  const g = goldTotals(t);
  const { date, time } = stamp(t.capturedAt);
  const cancelled = t.status === "void";
  const diff = Number(t.payout.difference);
  const wide = PAPER[settings.paper].widthMm === null;
  const live = t.payments.filter((p) => p.status !== "failed");
  const notes = Object.entries(t.payout.lines)
    .filter(([, n]) => n > 0)
    .sort((a, b) => Number(b[0]) - Number(a[0]));
  const rule = t.payoutPolicy ? payoutRuleText[t.payoutPolicy] : undefined;

  return (
    <article
      className={`receipt-paper relative mx-auto bg-white text-[11px] leading-snug text-neutral-900 ${wide ? "receipt-a4 px-[12mm] py-[10mm] text-[13px]" : "px-[4.5mm] pb-[6mm] pt-[5mm]"}`}
      style={{ width: wide ? "170mm" : `${PAPER[settings.paper].widthMm}mm` }}
      data-paper={settings.paper}
    >
      {cancelled ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <span className="-rotate-12 rounded-md border-4 border-red-700 px-3 py-1 text-3xl font-black tracking-widest text-red-700/80">
            CANCELLED
          </span>
        </div>
      ) : null}

      <header className="text-center">
        <div
          aria-hidden
          className="mx-auto mb-1.5 flex size-8 items-center justify-center rounded-full border-2 border-neutral-900 text-base font-black"
        >
          G
        </div>
        <h1
          className={`font-extrabold uppercase tracking-[0.12em] ${wide ? "text-xl" : "text-[15px]"}`}
        >
          {settings.businessName}
        </h1>
        {settings.tagline ? (
          <p className="text-[0.85em] uppercase tracking-widest text-neutral-500">
            {settings.tagline}
          </p>
        ) : null}
        {branchName ? <p className="mt-1 font-medium">{branchName}</p> : null}
        {settings.address ? (
          <p className="text-neutral-600">{settings.address}</p>
        ) : null}
        {settings.phone ? (
          <p className="text-neutral-600">Tel {settings.phone}</p>
        ) : null}
      </header>

      <Rule />
      <section className="space-y-0.5">
        <Row k="Receipt no." v={t.reference ?? "Pending"} bold />
        <Row k="Date" v={`${date}, ${time}`} />
        <Row k="Customer" v={t.customerName} />
        {t.customerPhone ? <Row k="Phone" v={t.customerPhone} /> : null}
        {t.representative ? (
          <Row k="Brought by" v={t.representative.name} />
        ) : null}
        {(servedBy ?? t.createdBy) ? (
          <Row k="Served by" v={(servedBy ?? t.createdBy) as string} />
        ) : null}
      </section>

      <Rule strong />
      <p className="mb-1.5 text-center text-[0.85em] font-bold uppercase tracking-[0.2em] text-neutral-500">
        Gold received
      </p>
      <ol className="space-y-2.5">
        {t.items.map((i, n) => (
          <li key={i.id} className="break-inside-avoid">
            <div className="flex items-baseline justify-between font-semibold">
              <span>
                {t.items.length > 1 ? `${n + 1}. ` : ""}
                {i.label || "Gold"}
              </span>
              <span className="tabular-nums">
                {i.result ? cedis(i.result.amount) : "—"}
              </span>
            </div>
            {i.result ? (
              <dl className="mt-1 grid grid-cols-3 gap-x-2 gap-y-0.5 text-center">
                {settings.showWeights ? (
                  <>
                    <Cell k="Top" v={trimNumber(i.top)} />
                    <Cell k="Down" v={trimNumber(i.down)} />
                    <Cell k="Density" v={trimNumber(i.result.density)} />
                  </>
                ) : null}
                <Cell k="Pounds" v={trimNumber(i.result.pounds)} />
                <Cell k="Carat" v={trimNumber(i.result.karat)} />
                <Cell k="Net" v={grams(i.result.netWeight)} />
              </dl>
            ) : (
              <p className="text-neutral-500">Not calculated</p>
            )}
            <p className="mt-0.5 text-right text-[0.9em] text-neutral-500 tabular-nums">
              at {cedis(i.price)} per pound
            </p>
          </li>
        ))}
      </ol>
      {t.items.length > 1 ? (
        <p className="mt-1.5 text-right text-[0.9em] text-neutral-600 tabular-nums">
          {g.items} items · {trimNumber(g.pounds.toFixed(4))} pounds ·{" "}
          {grams(g.netGrams)} net
        </p>
      ) : null}

      <Rule />
      <section className="space-y-0.5">
        <Row k="Value of gold" v={cedis(t.calculatedAmount)} />
        {diff !== 0 ? (
          <Row
            k={rule ?? "Rounding"}
            v={`${diff > 0 ? "+" : "−"}${cedis(Math.abs(diff))}`}
          />
        ) : null}
      </section>
      <div className="mt-2 rounded-sm border-2 border-neutral-900 px-2 py-1.5 text-center">
        <p className="text-[0.8em] font-bold uppercase tracking-[0.25em]">
          Amount paid to you
        </p>
        <p
          className={`font-black tabular-nums ${wide ? "text-4xl" : "text-[26px]"} leading-tight`}
        >
          {cedis(t.payout.payable)}
        </p>
      </div>

      {live.length > 0 ? (
        <>
          <Rule />
          <section className="space-y-0.5">
            {live.map((p) => (
              <Row
                key={p.id}
                k={`${paymentMethodText[p.method] ?? p.method}${p.status === "pending" ? " (awaiting)" : ""}`}
                v={cedis(p.amount)}
              />
            ))}
          </section>
        </>
      ) : null}
      {notes.length > 0 && !cancelled ? (
        <p className="mt-1.5 text-center text-[0.9em] text-neutral-600">
          Notes: {notes.map(([d, n]) => `${n} × ${d}`).join(" · ")}
        </p>
      ) : null}

      {t.sync !== "synced" ? (
        <p className="mt-2 rounded-sm bg-neutral-100 px-2 py-1 text-center text-[0.9em] text-neutral-700">
          Recorded on this device. The number is added once it is sent.
        </p>
      ) : null}

      <Rule strong />
      {settings.showQr ? (
        <div className="flex flex-col items-center gap-1">
          <div className={wide ? "size-28" : "size-[27mm]"}>
            <Qr text={receiptPayload(t)} />
          </div>
          <p className="font-mono text-[0.9em] tracking-wider text-neutral-600">
            {t.reference ?? "PENDING"}
          </p>
        </div>
      ) : null}
      {settings.footer ? (
        <p className="mt-2 text-center text-[0.95em] italic text-neutral-600">
          {settings.footer}
        </p>
      ) : null}
      <p className="mt-1 text-center text-[0.8em] text-neutral-400">
        Printed{" "}
        {new Date().toLocaleString("en-GH", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </article>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[0.75em] uppercase tracking-wider text-neutral-500">
        {k}
      </dt>
      <dd className="font-semibold tabular-nums">{v}</dd>
    </div>
  );
}
