import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A short row of steps with the current one marked. `current` is the index of the step the thing is at (earlier ones are done),
 * -1 when it was called off. `warn` colours the current step amber, for "done, but something did not match".
 */
export function Stepper({
  steps,
  current,
  warn,
}: {
  steps: readonly string[];
  current: number;
  warn?: boolean;
}) {
  const cancelled = current < 0;
  return (
    <ol className="flex items-center" aria-label="Progress">
      {steps.map((label, i) => {
        const done = !cancelled && i < current;
        const here = !cancelled && i === current;
        return (
          <li
            key={label}
            className={cn(
              "flex items-center",
              i < steps.length - 1 && "flex-1",
            )}
            aria-current={here ? "step" : undefined}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                  done && "border-emerald-600 bg-emerald-600 text-white",
                  here && !warn && "border-navy bg-navy text-white",
                  here && warn && "border-amber-600 bg-amber-600 text-white",
                  !done &&
                    !here &&
                    "border-border bg-card text-muted-foreground",
                  cancelled && "border-red-300 text-red-500",
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" aria-hidden />
                ) : cancelled && i === 0 ? (
                  <XIcon className="size-3.5" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-sm",
                  here ? "font-semibold" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </span>
            {i < steps.length - 1 ? (
              <span
                className={cn(
                  "mx-2 h-px min-w-3 flex-1",
                  done ? "bg-emerald-600" : "bg-border",
                )}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
