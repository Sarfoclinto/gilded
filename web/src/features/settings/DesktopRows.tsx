import { useEffect, useState } from "react";
import { Button } from "@/shared/ui/Button";
import {
  desktop,
  useDesktopUpdate,
  type PrinterInfo,
} from "@/shared/platform/platform";
import { BranchComputers } from "./BranchComputers";
import { usePersonalSettings } from "./personal";

function Row({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4 sm:px-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-md">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Settings that exist only in the Windows desktop app: receipt printer, version and updates, server address. */
export function DesktopRows() {
  const d = desktop();
  const mine = usePersonalSettings();
  const update = useDesktopUpdate((s) => s.update);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);

  useEffect(() => {
    void d?.printers
      .list()
      .then(setPrinters)
      .catch(() => setPrinters([]));
  }, [d]);

  if (!d) return null;
  return (
    <>
      <Row
        title="Receipt printer"
        help="Receipts go straight to this printer with no print window. Leave on 'Ask each time' to choose every time. Thermal receipt printers appear here once their Windows driver is installed."
      >
        <select
          className="min-h-9 rounded-lg border border-border bg-background px-2 text-sm"
          value={mine.receiptPrinter}
          onChange={(e) => mine.update({ receiptPrinter: e.target.value })}
          aria-label="Receipt printer"
        >
          <option value="">Ask each time</option>
          {printers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.displayName}
              {p.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      </Row>
      <BranchComputers />
      <Row
        title={`Gilded desktop ${d.version}`}
        help={
          update.state === "ready"
            ? `Version ${update.version} is ready to install.`
            : update.state === "downloading"
              ? "Downloading an update…"
              : "Updates download by themselves when this computer has a connection."
        }
      >
        {update.state === "ready" ? (
          <Button onClick={() => void d.updater.install()}>
            Restart to update
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void d.updater.check()}>
            Check for updates
          </Button>
        )}
      </Row>
    </>
  );
}
