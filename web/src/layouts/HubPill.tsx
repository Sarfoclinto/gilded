import { useHubState } from "@/shared/platform/platform";

/** Shown only on a computer that is the hub or has joined one. Says in a word whether the drawer is being shared right now. */
export function HubPill() {
  const hub = useHubState((s) => s.hub);
  if (hub.role === "off") return null;
  let label: string;
  let tone: "ok" | "warn" | "bad";
  let title: string;
  if (hub.role === "hub") {
    const running = !!hub.hub?.running;
    label = running ? "Hub" : "Hub stopped";
    tone = running ? "ok" : "bad";
    title = running
      ? `This computer is the branch hub (${hub.hub?.devices.length ?? 0} joined).`
      : (hub.hub?.error ?? "The hub could not start.");
  } else {
    const st = hub.member?.state ?? "unreachable";
    label = st === "connected" ? "Shared" : "Not shared";
    tone = st === "connected" ? "ok" : st === "unreachable" ? "warn" : "bad";
    title =
      st === "connected"
        ? `Sharing the drawer with ${hub.member?.hubName}.`
        : "Drawer not shared right now. This computer works on its own. If it stays like this, ask a manager to check the hub.";
  }
  const cls = {
    ok: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
    warn: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
    bad: "bg-red-500/15 text-red-700 dark:text-red-300",
  }[tone];
  return (
    <span
      role="status"
      title={title}
      aria-label={title}
      className={`inline-flex min-h-8 items-center rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
