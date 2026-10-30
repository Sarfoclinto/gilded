import {
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { label } from "./catalog";
import type { Assessment } from "./model";

const LEVEL = {
  low: {
    icon: ShieldCheck,
    text: "Low risk",
    cls: "bg-emerald-500/15 text-emerald-800",
  },
  medium: {
    icon: TriangleAlert,
    text: "Needs care",
    cls: "bg-amber-500/20 text-amber-900",
  },
  high: {
    icon: ShieldAlert,
    text: "High access",
    cls: "bg-red-500/15 text-red-800",
  },
} as const;

/** The plain-words review of a role. In the editor it updates as boxes are ticked. */
export function AssessmentView({
  a,
  onAdd,
  compact = false,
}: {
  a: Assessment;
  onAdd?: (permission: string) => void;
  compact?: boolean;
}) {
  const L = LEVEL[a.level];
  const nothing =
    a.risky.length === 0 && a.conflicts.length === 0 && a.missing.length === 0;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${L.cls}`}
        >
          <L.icon className="size-3.5" />
          {L.text}
        </span>
        <span className="text-xs text-muted-foreground">
          Assessment{compact ? "" : " of what this role can do"}
        </span>
      </div>
      {nothing ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-700" />
          Nothing sensitive, nothing clashing, nothing missing.
        </p>
      ) : null}
      {a.risky.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Sensitive access
          </p>
          <ul className="space-y-0.5">
            {a.risky.map((r) => (
              <li key={r.permission} className="flex items-center gap-2">
                <span
                  className={`size-2 rounded-full ${r.risk === "high" ? "bg-red-600" : "bg-amber-500"}`}
                />
                {label(r.permission)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {a.conflicts.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Duties that usually belong to different people
          </p>
          <ul className="space-y-0.5">
            {a.conflicts.map((c) => (
              <li key={c.a + c.b} className="text-amber-900">
                {c.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {a.missing.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Missing basics
          </p>
          <ul className="space-y-0.5">
            {a.missing.map((m) => (
              <li
                key={m.permission}
                className="flex flex-wrap items-center gap-2"
              >
                “{label(m.permission)}” is of little use without “
                {label(m.needs)}”.
                {onAdd ? (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => onAdd(m.needs)}
                  >
                    Add it
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {a.withOverrides > 0 ? (
        <p className="text-xs text-muted-foreground">
          {a.withOverrides} {a.withOverrides === 1 ? "person" : "people"} in
          this role {a.withOverrides === 1 ? "has" : "have"} personal extra
          access or restrictions on top of it.
        </p>
      ) : null}
    </div>
  );
}
