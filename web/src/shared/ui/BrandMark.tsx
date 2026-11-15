/** The Gilded crown-and-GG mark (public/logo-mark.svg, 400 by 420). Decorative: the name next to it carries the meaning. */
export function BrandMark({ className = "h-10" }: { className?: string }) {
  return (
    <img
      src="/logo-mark.svg"
      alt=""
      draggable={false}
      className={`aspect-[400/420] w-auto select-none object-contain ${className}`}
    />
  );
}

/** The mark with the name, for the places that introduce the app. */
export function Wordmark({
  className = "",
  markClass = "h-9",
  tone = "light",
}: {
  className?: string;
  markClass?: string;
  tone?: "light" | "dark";
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <BrandMark className={markClass} />
      <span
        className={`font-display text-xl font-semibold tracking-[0.28em] ${tone === "light" ? "text-white" : "text-navy"}`}
      >
        GILDED
      </span>
    </div>
  );
}

/**
 * A coin's milled edge: short ticks all the way round. It is the one decoration the sign-in page spends: turning very slowly (only when
 * the person has not asked for less motion), behind the mark.
 */
export function CoinEdge({
  className = "",
  ticks = 120,
}: {
  className?: string;
  ticks?: number;
}) {
  return (
    <svg
      viewBox="-100 -100 200 200"
      aria-hidden
      className={`motion-safe:animate-[coin-turn_240s_linear_infinite] ${className}`}
    >
      <circle
        r="97"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.4"
        opacity="0.5"
      />
      <circle
        r="76"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.4"
        opacity="0.35"
      />
      {Array.from({ length: ticks }, (_, i) => (
        <line
          key={i}
          x1="0"
          y1="-97"
          x2="0"
          y2={i % 5 === 0 ? "-88" : "-92"}
          stroke="currentColor"
          strokeWidth={i % 5 === 0 ? 0.9 : 0.5}
          transform={`rotate(${(360 / ticks) * i})`}
          opacity={i % 5 === 0 ? 0.9 : 0.55}
        />
      ))}
    </svg>
  );
}
