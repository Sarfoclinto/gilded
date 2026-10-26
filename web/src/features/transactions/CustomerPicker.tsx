import { useEffect, useMemo, useState } from "react";
import { useCustomerSearch, type Customer } from "@/features/customers/api";
import {
  localPeople,
  refreshDirectory,
  searchLocal,
  useCustomerDirectory,
} from "@/features/customers/directory";
import { useConnectivity } from "@/shared/offline/connectivity";
import { useDebounced } from "@/shared/lib/useDebounced";
import { TextField } from "@/shared/ui/TextField";

export interface CustomerValue {
  id: string | null;
  name: string;
  phone: string;
}

export interface RepresentativeValue {
  name: string;
  phone: string;
}

/**
 * Name and phone, with the people already known listed as you type: this branch's customers first, then the
 * rest of the company. Works offline from the copy kept on this device (see customers/directory).
 * Picking one links the purchase to that customer. A new name with a phone becomes a customer when saved.
 * "Someone brings this for the customer" records who came in, while the purchase still belongs to the customer.
 */
export function CustomerPicker({
  value,
  onChange,
  locked,
  branchId = null,
  representative = null,
  onRepresentative,
}: {
  value: CustomerValue;
  onChange: (v: CustomerValue) => void;
  locked?: boolean;
  branchId?: string | null;
  /** Leave both out where a representative makes no sense (e.g. loans). */
  representative?: RepresentativeValue | null;
  onRepresentative?: (r: RepresentativeValue | null) => void;
}) {
  const [focus, setFocus] = useState<"name" | "phone" | null>(null);
  const online = useConnectivity((s) => s.online);
  const text = focus === "phone" ? value.phone : value.name;
  const q = useDebounced(text, 250);
  const stamp = useCustomerDirectory((s) => s.fetchedAt + s.pending.length);

  useEffect(() => {
    if (branchId && online) void refreshDirectory(branchId);
  }, [branchId, online]);

  const remote = useCustomerSearch(
    focus && !value.id && online ? q : "",
    branchId,
  );
  const list = useMemo<Customer[]>(() => {
    if (value.id || !focus || text.trim().length < 2) return [];
    const local = searchLocal(localPeople(branchId), text).map((c) => ({
      ...c,
      atBranch: true,
    }));
    const seen = new Set<string>();
    // Server answers (branch first, then company-wide) lead; the local copy fills in while offline or still loading.
    return [...(remote.data ?? []), ...local]
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.id, focus, text, branchId, remote.data, stamp]);
  const offlineList = !online && list.length > 0;

  const pick = (c: Customer) => {
    onChange({ id: c.id, name: c.name, phone: c.phone ?? "" });
    setFocus(null);
  };
  // Editing after picking means it is someone else (or a new person): forget the link.
  const edit = (patch: Partial<CustomerValue>) =>
    onChange({ ...value, ...patch, id: null });

  const identified =
    !!value.id ||
    (value.name.trim().length > 0 &&
      value.phone.replace(/\D/g, "").length >= 6);

  return (
    <div className="relative">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Customer name"
          value={value.name}
          disabled={locked}
          onChange={(e) => edit({ name: e.target.value })}
          onFocus={() => setFocus("name")}
          onBlur={() => setFocus(null)}
          autoComplete="off"
        />
        <TextField
          label="Phone"
          inputMode="tel"
          value={value.phone}
          disabled={locked}
          onChange={(e) => edit({ phone: e.target.value })}
          onFocus={() => setFocus("phone")}
          onBlur={() => setFocus(null)}
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
          New customer. A phone number is needed so they are saved and can be
          found next time.
        </p>
      )}
      {list.length > 0 ? (
        <ul
          className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-card shadow-lg"
          role="listbox"
        >
          {offlineList ? (
            <li className="px-3 py-1 text-xs text-muted-foreground">
              Offline: showing customers saved on this device
            </li>
          ) : null}
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
                <span className="font-medium">
                  {c.name}
                  {c.atBranch ? null : (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      other branch
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {c.phone ?? "no phone"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!locked && onRepresentative ? (
        <div className="mt-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={representative !== null}
              onChange={(e) =>
                onRepresentative(
                  e.target.checked ? { name: "", phone: "" } : null,
                )
              }
            />
            Someone is bringing this for the customer
          </label>
          {representative ? (
            <div className="mt-1 grid gap-3 sm:grid-cols-2">
              <TextField
                label="Name of the person who came"
                value={representative.name}
                onChange={(e) =>
                  onRepresentative({ ...representative, name: e.target.value })
                }
                autoComplete="off"
              />
              <TextField
                label="Their phone (optional)"
                inputMode="tel"
                value={representative.phone}
                onChange={(e) =>
                  onRepresentative({ ...representative, phone: e.target.value })
                }
                autoComplete="off"
              />
              {!identified ? (
                <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">
                  Say whose gold this is: pick the customer, or type their name
                  and phone above.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
