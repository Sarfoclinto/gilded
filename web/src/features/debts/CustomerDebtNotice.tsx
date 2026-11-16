import { Link } from "react-router-dom";
import { AlertTriangleIcon, CheckCircle2Icon, ShieldIcon } from "lucide-react";
import paths from "@/config/paths";
import { cedis } from "@/features/calculator/format";
import { useCustomerDebts } from "./api";
import { dueOf, owesHeadline } from "./model";

/**
 * Shown on the loan page once a customer is chosen: what they already owe across the branches you can see, loan by loan, so the lender decides
 * with the whole picture. It only informs: lending is never blocked here. `adding` is the new loan, to show the total it would bring them to.
 */
export function CustomerDebtNotice({
  customerId,
  name,
  adding,
}: {
  customerId: string | null | undefined;
  name: string;
  adding: number;
}) {
  const q = useCustomerDebts(customerId);
  if (!customerId) return null;
  if (q.isLoading)
    return (
      <div
        className="h-12 animate-pulse rounded-xl bg-muted"
        aria-label="Checking what this customer owes"
      />
    );
  if (q.isError || !q.data) return null; // not allowed to read debts, or offline: say nothing rather than guess
  const s = q.data;
  const who = name.trim() || "This customer";
  const owes = s.items.length > 0;
  const anyOverdue = s.items.some((d) => dueOf(d).state === "overdue");
  return (
    <section
      role="status"
      aria-label="What this customer already owes"
      className={`space-y-2 rounded-xl border p-3 text-sm ${anyOverdue ? "border-red-200 bg-red-50 text-red-900" : owes ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-900"}`}
    >
      <p className="flex items-start gap-2 font-semibold">
        {owes ? (
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span>{owesHeadline(who, s, cedis)}</span>
      </p>
      {owes ? (
        <ul className="space-y-1.5">
          {s.items.map((d) => {
            const due = dueOf(d);
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-white/70 px-2.5 py-1.5"
              >
                <span className="tnum font-semibold">
                  {cedis(Number(d.outstanding))}
                </span>
                <span className="text-xs">
                  of {cedis(Number(d.principal))} · {d.branchName ?? "Branch"} ·{" "}
                  {new Date(d.issuedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                {due.text ? (
                  <span
                    className={`text-xs font-medium ${due.state === "overdue" ? "text-red-700" : ""}`}
                  >
                    {due.text}
                  </span>
                ) : null}
                {d.collateral?.status === "held" ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <ShieldIcon className="size-3.5" aria-hidden />
                    We hold their gold
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {s.elsewhere > 0 ? (
        <p className="text-xs">
          They also have {s.elsewhere} open loan{s.elsewhere === 1 ? "" : "s"}{" "}
          at other branches that you cannot see.
        </p>
      ) : null}
      {owes && adding > 0 ? (
        <p className="text-xs">
          With this loan they would owe{" "}
          <strong className="tnum">{cedis(Number(s.total) + adding)}</strong> at
          your branches.
        </p>
      ) : null}
      {owes ? (
        <Link
          to={paths.debts.href}
          className="inline-block text-xs font-medium underline underline-offset-2"
        >
          Open Debts and loans
        </Link>
      ) : null}
    </section>
  );
}
