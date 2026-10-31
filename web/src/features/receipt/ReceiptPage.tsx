import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { useTransactionView } from "@/features/transactions/hooks";
import { Button } from "@/shared/ui/Button";
import { Receipt } from "./Receipt";
import { PAPER, useReceiptSettings, type PaperSize } from "./settings";

/**
 * The receipt on its own, with none of the app around it. Open it from a purchase to look at it or print it.
 * `?print=1` prints as soon as it has loaded and `?bare=1` hides the toolbar, so a desktop shell (or a kiosk) can open this
 * address and send it straight to a printer. Nothing here needs a printer: it is also the on-screen receipt.
 */
export default function ReceiptPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { view: t, isLoading } = useTransactionView(id);
  const settings = useReceiptSettings();
  const branchNames = useBranchNames();
  const user = useAuth((s) => s.user);
  const bare = params.get("bare") === "1";
  const auto = params.get("print") === "1";
  const paperParam = params.get("paper");
  const paper: PaperSize =
    paperParam && paperParam in PAPER
      ? (paperParam as PaperSize)
      : settings.paper;
  const shown = { ...settings, paper };

  // The page size has to be set by a rule in the document, so one is written for the chosen paper.
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = `@page { ${PAPER[paper].page ? `size: ${PAPER[paper].page}; ` : ""}margin: ${paper === "a4" ? "12mm" : "0"}; }`;
    document.head.appendChild(el);
    return () => el.remove();
  }, [paper]);

  useEffect(() => {
    if (!auto || !t) return;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [auto, t]);

  if (isLoading)
    return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  if (!t)
    return (
      <p className="p-6 text-sm">
        Receipt not found.{" "}
        <Link className="underline" to={paths.transactions.list.href}>
          Back to transactions
        </Link>
      </p>
    );

  return (
    <div className="receipt-screen min-h-dvh bg-neutral-200 px-3 py-4 print:min-h-0 print:bg-white print:p-0">
      {bare ? null : (
        <div className="mx-auto mb-4 flex max-w-[170mm] flex-wrap items-center justify-between gap-2 print:hidden">
          <Link
            to={paths.transactions.detail.to(t.id)}
            className="inline-flex items-center gap-1 text-sm text-neutral-700 hover:underline"
          >
            <ArrowLeftIcon className="size-4" aria-hidden /> Back to purchase
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-neutral-700">
              Paper
              <select
                className="rounded-md border border-neutral-400 bg-white px-2 py-1 text-sm"
                value={paper}
                onChange={(e) =>
                  settings.update({ paper: e.target.value as PaperSize })
                }
              >
                {(Object.keys(PAPER) as PaperSize[]).map((k) => (
                  <option key={k} value={k}>
                    {PAPER[k].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={settings.showQr}
                onChange={(e) => settings.update({ showQr: e.target.checked })}
              />{" "}
              Code
            </label>
            <Button onClick={() => window.print()}>
              <PrinterIcon className="mr-1.5 size-4" aria-hidden />
              Print
            </Button>
          </div>
        </div>
      )}
      <div className="receipt-sheet mx-auto w-fit shadow-xl print:shadow-none">
        <Receipt
          t={t}
          settings={shown}
          branchName={branchNames[t.branchId]}
          servedBy={t.createdBy ?? user?.displayName}
        />
      </div>
    </div>
  );
}
