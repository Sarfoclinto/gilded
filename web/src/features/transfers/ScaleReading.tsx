import { ScaleIcon, TriangleAlertIcon } from "lucide-react";
import { SCALE_TEXT, SCALE_TONE, signedGrams } from "./model";
import type { ScaleLevel } from "./schemas";

/** One line of the comparison: what the books say, what the scale said, and how far apart they are. */
function Row({
  label,
  books,
  scale,
  diff,
  level,
}: {
  label: string;
  books: number;
  scale: number;
  diff: number;
  level: ScaleLevel;
}) {
  return (
    <div
      className={`grid grid-cols-[4rem_1fr_1fr_auto] items-center gap-2 rounded-lg border px-3 py-2 text-sm ${SCALE_TONE[level]}`}
    >
      <span className="font-semibold">{label}</span>
      <span className="tnum">
        <span className="block text-[11px] uppercase opacity-70">Books</span>
        {books.toFixed(2)} g
      </span>
      <span className="tnum">
        <span className="block text-[11px] uppercase opacity-70">Scale</span>
        {scale.toFixed(2)} g
      </span>
      <span className="tnum text-right font-semibold">{signedGrams(diff)}</span>
    </div>
  );
}

/** The scale's reading beside the books, coloured by how serious the gap is. Used before and after the handover. */
export function ScaleReading({
  booksTop,
  booksDown,
  scaleTop,
  scaleDown,
  topLevel,
  downLevel,
  level,
  downAllowance,
}: {
  booksTop: number;
  booksDown: number;
  scaleTop: number;
  scaleDown: number;
  topLevel: ScaleLevel;
  downLevel: ScaleLevel;
  level: ScaleLevel;
  downAllowance: number;
}) {
  const Icon = level === "ok" ? ScaleIcon : TriangleAlertIcon;
  return (
    <div className="space-y-2" aria-live="polite">
      <Row
        label="Top"
        books={booksTop}
        scale={scaleTop}
        diff={scaleTop - booksTop}
        level={topLevel}
      />
      <Row
        label="Down"
        books={booksDown}
        scale={scaleDown}
        diff={scaleDown - booksDown}
        level={downLevel}
      />
      <p
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${SCALE_TONE[level]}`}
      >
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {SCALE_TEXT[level]}.{" "}
          <span className="font-normal">
            {level === "ok"
              ? ""
              : `The down may differ by up to ${downAllowance.toFixed(2)} g for this many pieces. `}
            {level === "critical"
              ? "The difference is recorded and the reviewers are told."
              : level === "alert"
                ? "It is recorded. Weigh again to be sure."
                : ""}
          </span>
        </span>
      </p>
    </div>
  );
}
