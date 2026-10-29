const tones = {
  amber: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  red: "bg-red-500/20 text-red-700 dark:text-red-300",
  sky: "bg-sky-500/20 text-sky-800 dark:text-sky-300",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  grey: "bg-muted text-muted-foreground",
};

export type ChipTone = keyof typeof tones;

/** A small status label. */
export function Chip({
  tone = "grey",
  children,
}: {
  tone?: ChipTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
