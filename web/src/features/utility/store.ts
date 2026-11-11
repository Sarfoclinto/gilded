import { create } from "zustand";

export type UtilityTab = "calculator" | "notes" | "cash" | "customer";

/** The customer the person is working on, shared by the New transaction page (which writes it) and the panel (which only reads it). */
export interface LookupCustomer {
  id: string | null;
  name: string;
  phone: string;
}

/** Per session only; nothing here is saved. The page sets it as the person types and clears it when they leave. */
export const useCustomerLookup = create<{
  customer: LookupCustomer | null;
  set: (c: LookupCustomer | null) => void;
}>((set) => ({
  customer: null,
  set: (customer) => set({ customer }),
}));

/** True when there is something to look up: a picked customer, or a typed name or phone. */
export const hasLookup = (c: LookupCustomer | null): c is LookupCustomer =>
  !!c &&
  (!!c.id ||
    c.name.trim().length >= 2 ||
    c.phone.replace(/\D/g, "").length >= 6);

interface PanelState {
  open: boolean;
  tab: UtilityTab;
  toggle: () => void;
  setOpen: (v: boolean) => void;
  setTab: (t: UtilityTab) => void;
  /** The floating button: opens the panel, on the customer's history when a customer is being worked on. */
  openFromButton: () => void;
}

/** Whether the panel is open and which tab it shows. Per session only; it never holds or saves anything by itself. */
export const useUtilityPanel = create<PanelState>((set, get) => ({
  open: false,
  tab: "calculator",
  toggle: () => (get().open ? set({ open: false }) : get().openFromButton()),
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
  openFromButton: () =>
    set({
      open: true,
      ...(hasLookup(useCustomerLookup.getState().customer)
        ? { tab: "customer" as const }
        : {}),
    }),
}));
