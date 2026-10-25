import { Link } from "react-router-dom";
import paths from "@/config/paths";
import { useConnectivity } from "@/shared/offline/connectivity";
import { useOutbox } from "@/shared/offline/OutboxProvider";

export function ConnectionBadge() {
  const online = useConnectivity((s) => s.online);
  const { waiting } = useOutbox();
  const cls = `inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
    online
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
  }`;
  const dot = (
    <span
      className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}
    />
  );

  return (
    <div className="flex items-center gap-2">
      {waiting.length > 0 ? (
        <Link
          to={paths.transactions.list.href}
          className="inline-flex min-h-8 items-center rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300"
        >
          {waiting.length} waiting
        </Link>
      ) : null}
      <span role="status" className={cls}>
        {dot}
        {online ? "Online" : "Offline"}
      </span>
    </div>
  );
}
