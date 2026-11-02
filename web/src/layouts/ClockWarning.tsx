import { AlertTriangleIcon } from "lucide-react";
import { clockIsOff, describeSkew, useClock } from "@/shared/offline/clock";

/** Shown when this device's clock disagrees with the server's. Purchases are stamped with the device clock. */
export function ClockWarning() {
  const skew = useClock((s) => s.skewMs);
  if (!clockIsOff(skew) || skew === null) return null;
  return (
    <p
      role="alert"
      className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-500/10 p-3 text-sm sm:mx-6"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong>This device's clock is wrong</strong> ({describeSkew(skew)}).
        Purchases are stamped with it. Correct the date and time in the device
        settings before saving purchases.
      </span>
    </p>
  );
}
