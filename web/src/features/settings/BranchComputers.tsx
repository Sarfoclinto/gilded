import { useState } from "react";
import { Input } from "antd";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { PERMISSIONS } from "@/config/permissions";
import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/toast";
import { desktop, runHub, useHubState } from "@/shared/platform/platform";

const memberText: Record<string, string> = {
  connected: "Connected to the hub.",
  unreachable:
    "Cannot reach the hub right now. This computer keeps working on its own.",
  "different-hub":
    "The computer answering is not the hub this one was paired with. Nothing is sent to it.",
  "not-paired":
    "The hub no longer knows this computer. Join again with a new code.",
};

function Row({
  title,
  help,
  children,
}: {
  title: string;
  help: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <div className="mt-0.5 text-sm text-muted-foreground">{help}</div>
      </div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

/**
 * Desktop app only. Computers in one branch can share the drawer: one is the hub (usually the manager's), the others join it with a code.
 * Setting it up is for people who manage settings; the others just see how the computer is doing in the header.
 */
export function BranchComputers() {
  const d = desktop();
  const hub = useHubState((s) => s.hub);
  const branchId = useAuth((s) => s.activeBranchId);
  const can = useHasPermission(PERMISSIONS.SETTINGS_MANAGE);
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  if (!d?.hub) return null;
  if (!can) {
    return (
      <Row
        title="Shared drawer for this branch"
        help="Setting this computer up to share the drawer is done by a manager."
      >
        <span className="text-sm">
          {hub.role === "off"
            ? "Not set up on this computer. Ask a manager."
            : hub.role === "hub"
              ? "This computer is the branch hub."
              : "This computer shares the drawer with the branch hub."}
        </span>
      </Row>
    );
  }

  const act = async (fn: Parameters<typeof runHub>[0], ok?: string) => {
    setBusy(true);
    const problem = await runHub(fn);
    setBusy(false);
    if (problem) toast.error(problem);
    else if (ok) toast.success(ok);
  };

  return (
    <>
      <Row
        title="Shared drawer for this branch"
        help="When a branch has more than one computer, one of them (the hub) can keep the drawer in step between them, even with no internet. Without it every computer works alone, as before."
      >
        {hub.role === "off" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-48"
              placeholder="Name, e.g. Front desk"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              aria-label="Name for the hub computer"
            />
            <Button
              loading={busy}
              disabled={!branchId}
              onClick={() =>
                void act(
                  (h) => h.become(branchId!, name || "Hub"),
                  "This computer is now the hub",
                )
              }
            >
              Make this computer the hub
            </Button>
          </div>
        ) : null}
      </Row>

      {hub.role === "hub" && hub.hub ? (
        <Row
          title={`This computer is the hub · ${hub.hub.name}`}
          help={
            hub.hub.error ? (
              <span className="text-red-700">{hub.hub.error}</span>
            ) : (
              <>
                Other computers in this branch join at {hub.hub.address}. Keep
                this computer on while the branch is open.
              </>
            )
          }
        >
          {hub.hub.code ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Type this whole line on the other computer (Settings → This
                device). It works once, for 10 minutes.
              </p>
              <p className="tnum select-all break-all font-mono text-base font-semibold">
                {hub.hub.code.text}
              </p>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button loading={busy} onClick={() => void act((h) => h.newCode())}>
              {hub.hub.code ? "New code" : "Add a computer"}
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void act((h) => h.off(), "Back to working alone")}
            >
              Stop being the hub
            </Button>
          </div>
          {hub.hub.devices.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {hub.hub.devices.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <span>
                    {p.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      {p.lastSeen
                        ? `· seen ${new Date(p.lastSeen).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                        : "· not seen yet"}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void act((h) => h.revoke(p.id), `${p.name} removed`)
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Row>
      ) : null}

      {hub.role === "member" && hub.member ? (
        <Row
          title={`Joined to ${hub.member.hubName}`}
          help={memberText[hub.member.state]}
        >
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => void act((h) => h.off(), "Back to working alone")}
          >
            Leave the hub
          </Button>
        </Row>
      ) : null}

      {hub.role === "off" ? (
        <Row
          title="Join a hub"
          help="On the hub computer choose “Add a computer”, then type the line it shows here."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs font-mono"
              placeholder="192.168.1.5:47600#123456#A1B2…"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              aria-label="Line shown on the hub computer"
            />
            <Button
              loading={busy}
              disabled={line.trim().length < 10}
              onClick={() =>
                void act((h) => h.join(line), "Joined the hub").then(() =>
                  setLine(""),
                )
              }
            >
              Join
            </Button>
          </div>
        </Row>
      ) : null}
    </>
  );
}
