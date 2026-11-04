import { RefreshCwIcon } from "lucide-react";
import { desktop, useDesktopUpdate } from "@/shared/platform/platform";
import { usePwa } from "@/shared/pwa/pwa";

/**
 * A new version is downloaded and waiting. Updating reloads (web) or restarts (desktop app);
 * drafts and unsent purchases are kept on the device either way.
 */
export function UpdateBanner() {
  const need = usePwa((s) => s.needRefresh);
  const apply = usePwa((s) => s.apply);
  const dismiss = usePwa((s) => s.dismissUpdate);
  const du = useDesktopUpdate((s) => s.update);

  if (desktop()) {
    if (du.state === "downloading") {
      return (
        <div
          role="status"
          className="border-b border-gold/40 bg-gold/10 px-4 py-1.5 text-xs"
        >
          Downloading a new version of Gilded
          {du.percent ? ` (${du.percent}%)` : ""}…
        </div>
      );
    }
    if (du.state !== "ready") return null;
    return (
      <Bar
        onLater={null}
        onApply={() => void desktop()?.updater.install()}
        apply="Restart now"
      >
        Gilded {du.version} is ready. It also installs by itself the next time
        the app is closed.
      </Bar>
    );
  }

  if (!need || !apply) return null;
  return (
    <Bar onLater={dismiss} onApply={() => void apply()} apply="Update now">
      A new version of Gilded is ready.
    </Bar>
  );
}

function Bar({
  children,
  apply,
  onApply,
  onLater,
}: {
  children: React.ReactNode;
  apply: string;
  onApply: () => void;
  onLater: (() => void) | null;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/40 bg-gold/15 px-4 py-2 text-sm"
    >
      <span className="flex items-center gap-2">
        <RefreshCwIcon className="size-4" aria-hidden /> {children}
      </span>
      <span className="flex gap-2">
        {onLater ? (
          <button
            type="button"
            onClick={onLater}
            className="min-h-9 rounded-lg px-3 hover:bg-black/5"
          >
            Later
          </button>
        ) : null}
        <button
          type="button"
          onClick={onApply}
          className="min-h-9 rounded-lg bg-navy px-3 font-medium text-white"
        >
          {apply}
        </button>
      </span>
    </div>
  );
}
