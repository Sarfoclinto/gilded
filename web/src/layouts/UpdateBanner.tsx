import { RefreshCwIcon } from "lucide-react";
import { usePwa } from "@/shared/pwa/pwa";

/** A new version is downloaded and waiting. Updating reloads the page; drafts and unsent purchases are kept on the device. */
export function UpdateBanner() {
  const need = usePwa((s) => s.needRefresh);
  const apply = usePwa((s) => s.apply);
  const dismiss = usePwa((s) => s.dismissUpdate);
  if (!need || !apply) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/40 bg-gold/15 px-4 py-2 text-sm"
    >
      <span className="flex items-center gap-2">
        <RefreshCwIcon className="size-4" aria-hidden /> A new version of Gilded
        is ready.
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="min-h-9 rounded-lg px-3 hover:bg-black/5"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => void apply()}
          className="min-h-9 rounded-lg bg-navy px-3 font-medium text-white"
        >
          Update now
        </button>
      </span>
    </div>
  );
}
