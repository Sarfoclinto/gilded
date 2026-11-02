import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAuth } from "@/features/auth/store";
import type { RepresentativeValue, CustomerValue } from "./CustomerPicker";
import type { SplitDraft } from "./split";

/**
 * A purchase that was started and not saved, kept on this device so a teller can leave the page (to check a customer, answer the phone)
 * and come back to it. One per person per branch. It is the form as typed, nothing more: it records nothing in the books until Save.
 */
export interface PurchaseDraft {
  txId: string;
  newCustomerId: string;
  customer: CustomerValue;
  rep: RepresentativeValue | null;
  town: { id: string; name: string } | null;
  items: {
    id: string;
    label: string;
    top: string;
    down: string;
    price: string;
    priceTouched: boolean;
  }[];
  parts: SplitDraft[];
  savedAt: string;
}

/** A draft older than this belongs to another working day and is dropped rather than offered. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export const draftKey = (
  userId: string | undefined | null,
  branchId: string | undefined | null,
) => (userId && branchId ? `${userId}:${branchId}` : null);

/** Whether the form holds anything worth keeping (an untouched form is not a draft). */
export function isMeaningful(
  d: Pick<PurchaseDraft, "customer" | "rep" | "town" | "items" | "parts">,
): boolean {
  return (
    d.customer.name.trim() !== "" ||
    d.customer.phone.trim() !== "" ||
    d.rep !== null ||
    d.town !== null ||
    d.parts.length > 0 ||
    d.items.some((i) => i.top.trim() !== "" || i.down.trim() !== "")
  );
}

/** The draft to offer, or null when there is none, it is empty, or it is too old. */
export function usableDraft(
  d: PurchaseDraft | undefined | null,
  now = Date.now(),
): PurchaseDraft | null {
  if (!d || !isMeaningful(d)) return null;
  const at = Date.parse(d.savedAt);
  return Number.isFinite(at) && now - at <= DRAFT_MAX_AGE_MS ? d : null;
}

interface State {
  drafts: Record<string, PurchaseDraft>;
  put: (key: string, draft: PurchaseDraft) => void;
  clear: (key: string) => void;
}

export const useDraftStore = create<State>()(
  persist(
    (set) => ({
      drafts: {},
      put: (key, draft) =>
        set((s) => ({ drafts: { ...s.drafts, [key]: draft } })),
      clear: (key) =>
        set((s) => {
          const { [key]: _gone, ...rest } = s.drafts;
          return { drafts: rest };
        }),
    }),
    { name: "gold.purchaseDraft.v1", partialize: ({ drafts }) => ({ drafts }) },
  ),
);

/** Whether the signed-in person has an unfinished purchase at the branch they are working in (for "Continue" on the New purchase buttons). */
export function useHasDraft(): boolean {
  const key = draftKey(
    useAuth((s) => s.user?.id),
    useAuth((s) => s.activeBranchId),
  );
  return useDraftStore((s) =>
    key ? usableDraft(s.drafts[key]) !== null : false,
  );
}
