import { useState } from "react";
import { useCustomerSearch, type Customer } from "@/features/customers/api";
import { useDebounced } from "@/shared/lib/useDebounced";
import { TextField } from "@/shared/ui/TextField";

export interface CustomerValue {
  id: string | null;
  name: string;
  phone: string;
}

/**
 * Name and phone, with a list of people already known as you type. Picking one links the purchase to that customer
 * (needed to settle their debts). Typing a new name just creates the customer when the purchase is saved.
 */
export function CustomerPicker({
  value,
  onChange,
  locked,
}: {
  value: CustomerValue;
  onChange: (v: CustomerValue) => void;
  locked?: boolean;
}) {
  const [focus, setFocus] = useState<"name" | "phone" | null>(null);
  const q = useDebounced(focus === "phone" ? value.phone : value.name, 250);
  const found = useCustomerSearch(focus && !value.id ? q : "");
  const list = value.id || !focus ? [] : (found.data ?? []).slice(0, 6);

  const pick = (c: Customer) => {
    onChange({ id: c.id, name: c.name, phone: c.phone ?? "" });
    setFocus(null);
  };
  // Editing after picking means it is someone else (or a new person): forget the link.
  const edit = (patch: Partial<CustomerValue>) =>
    onChange({ ...value, ...patch, id: null });

  return (
    <div className="relative">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Customer name"
          value={value.name}
          disabled={locked}
          onChange={(e) => edit({ name: e.target.value })}
          onFocus={() => setFocus("name")}
          autoComplete="off"
        />
        <TextField
          label="Phone"
          inputMode="tel"
          value={value.phone}
          disabled={locked}
          onChange={(e) => edit({ phone: e.target.value })}
          onFocus={() => setFocus("phone")}
          autoComplete="off"
        />
      </div>
      {value.id ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
          Existing customer
          {locked ? "" : " · edit the name or phone to choose someone else"}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          New customer. Add a phone number so they can be found next time.
        </p>
      )}
      {list.length > 0 ? (
        <ul
          className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-card shadow-lg"
          role="listbox"
        >
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-muted-foreground">
                  {c.phone ?? "no phone"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
