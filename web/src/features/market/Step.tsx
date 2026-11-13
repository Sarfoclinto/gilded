import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";

/** "+50 (0.4%)" in green, "−50" in red, or "no change". Up is not "good" or "bad" here: it is only the direction. */
export function Step({
  change,
  percent,
}: {
  change: number;
  percent?: number;
}) {
  if (change === 0)
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <MinusIcon className="size-3.5" aria-hidden />
        No change
      </span>
    );
  const up = change > 0;
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span
      className={`tnum inline-flex items-center gap-0.5 font-semibold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {up ? "+" : "−"}
      {Math.abs(change).toLocaleString("en-GH", { maximumFractionDigits: 2 })}
      {percent !== undefined && percent !== 0 ? (
        <span className="font-normal"> ({Math.abs(percent).toFixed(2)}%)</span>
      ) : null}
    </span>
  );
}
