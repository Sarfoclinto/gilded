import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PlusIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { useHasDraft } from "@/features/transactions/draft";

/** True when a key press is meant for a form field (so a shortcut must stay out of the way). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
}

/** Press N anywhere (outside a field) to start a purchase. Only for people who may record purchases. */
export function useNewPurchaseShortcut() {
  const allowed = useHasPermission(PERMISSIONS.TRANSACTIONS_CREATE);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== "n" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        isTyping(e.target)
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      if (pathname !== paths.transactions.create.href)
        navigate(paths.transactions.create.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowed, navigate, pathname]);
}

/** The gold "New purchase" button in the header: one tap from any page. Hidden where it would lead to the page already open. */
export function NewPurchaseButton({ compact = false }: { compact?: boolean }) {
  const allowed = useHasPermission(PERMISSIONS.TRANSACTIONS_CREATE);
  const { pathname } = useLocation();
  const hasDraft = useHasDraft();
  if (!allowed || pathname === paths.transactions.create.href) return null;
  return (
    <Link
      to={paths.transactions.create.href}
      aria-label={hasDraft ? "Continue your purchase" : "New purchase"}
      title={
        hasDraft ? "Continue your purchase (press N)" : "New purchase (press N)"
      }
      className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-gradient-to-br from-[#C9A84C] to-[#E8C97A] font-semibold text-[#0D1B2E] shadow-sm hover:brightness-95 ${compact ? "w-10" : "px-4 text-sm"}`}
    >
      <PlusIcon className="size-5" aria-hidden />
      {compact ? null : (
        <span>{hasDraft ? "Continue purchase" : "New purchase"}</span>
      )}
    </Link>
  );
}
