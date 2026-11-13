/**
 * A purchase started for a known customer from somewhere else (the global search): the New transaction page opens with that customer chosen.
 * Carried in the navigation state, like the calculator's values, so nothing is put in the address bar.
 */
export interface CustomerPrefill {
  id: string | null;
  name: string;
  phone: string;
}

export function readCustomerPrefill(state: unknown): CustomerPrefill | null {
  const c = (state as { customer?: Partial<CustomerPrefill> } | null)?.customer;
  if (!c || typeof c.name !== "string" || !c.name.trim()) return null;
  return {
    id: typeof c.id === "string" && c.id ? c.id : null,
    name: c.name,
    phone: typeof c.phone === "string" ? c.phone : "",
  };
}
