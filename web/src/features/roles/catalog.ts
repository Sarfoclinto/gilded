import { permissionLabels } from "@/config/permissionLables";
import { PERMISSIONS as P, type Permission } from "@/config/permissions";

export type Risk = "high" | "medium";

/** What the system can do, grouped the way a director thinks about it. */
export const GROUPS: {
  key: string;
  title: string;
  permissions: Permission[];
}[] = [
  {
    key: "buying",
    title: "Buying gold",
    permissions: [
      P.CALCULATOR_USE,
      P.TRANSACTIONS_READ,
      P.TRANSACTIONS_CREATE,
      P.CUSTOMERS_READ,
      P.CUSTOMERS_MANAGE,
    ],
  },
  {
    key: "cash",
    title: "Cash and days",
    permissions: [P.DAYS_READ, P.DAYS_MANAGE, P.DAYS_SIGNOFF],
  },
  {
    key: "money",
    title: "Debts and mobile money",
    permissions: [P.DEBTS_READ, P.DEBTS_MANAGE, P.PAYMENTS_CONFIRM],
  },
  {
    key: "between",
    title: "Between branches",
    permissions: [P.TRANSFERS_READ, P.TRANSFERS_CREATE, P.TRANSFERS_RECEIVE],
  },
  {
    key: "prices",
    title: "Prices",
    permissions: [P.KUMASI_SET_VALUE, P.PRICES_APPROVE],
  },
  {
    key: "oversight",
    title: "Oversight",
    permissions: [
      P.REPORTS_READ,
      P.DISCREPANCIES_REVIEW,
      P.AUDIT_READ,
      P.BRANCHES_ALL,
    ],
  },
  {
    key: "admin",
    title: "Administration",
    permissions: [
      P.USERS_MANAGE,
      P.BRANCHES_MANAGE,
      P.IMPORTS_MANAGE,
      P.SETTINGS_MANAGE,
    ],
  },
];

/** Permissions that can move money, change the books' rules or give others access. */
export const RISK: Partial<Record<Permission, Risk>> = {
  [P.USERS_MANAGE]: "high",
  [P.BRANCHES_MANAGE]: "high",
  [P.IMPORTS_MANAGE]: "high",
  [P.SETTINGS_MANAGE]: "high",
  [P.PRICES_APPROVE]: "high",
  [P.AUDIT_READ]: "medium",
  [P.DAYS_SIGNOFF]: "medium",
  [P.KUMASI_SET_VALUE]: "medium",
  [P.DISCREPANCIES_REVIEW]: "medium",
  [P.DEBTS_MANAGE]: "medium",
  [P.PAYMENTS_CONFIRM]: "medium",
  [P.BRANCHES_ALL]: "medium",
  [P.CUSTOMERS_MANAGE]: "medium",
};

/** A permission that is of little use without another one. Offered as "add it" in the editor. */
export const NEEDS: Partial<Record<Permission, Permission>> = {
  [P.TRANSACTIONS_CREATE]: P.TRANSACTIONS_READ,
  [P.DAYS_MANAGE]: P.DAYS_READ,
  [P.DAYS_SIGNOFF]: P.DAYS_READ,
  [P.DEBTS_MANAGE]: P.DEBTS_READ,
  [P.CUSTOMERS_MANAGE]: P.CUSTOMERS_READ,
  [P.TRANSFERS_CREATE]: P.TRANSFERS_READ,
  [P.TRANSFERS_RECEIVE]: P.TRANSFERS_READ,
  [P.PAYMENTS_CONFIRM]: P.TRANSACTIONS_READ,
  [P.PRICES_APPROVE]: P.TRANSACTIONS_READ,
  [P.DISCREPANCIES_REVIEW]: P.REPORTS_READ,
};

/** Duties that should usually belong to different people ("four eyes"). */
export const CONFLICTS: { a: Permission; b: Permission; why: string }[] = [
  {
    a: P.TRANSACTIONS_CREATE,
    b: P.DAYS_SIGNOFF,
    why: "Records purchases and also signs off the days they are in.",
  },
  {
    a: P.KUMASI_SET_VALUE,
    b: P.PRICES_APPROVE,
    why: "Sets prices and also approves them.",
  },
  {
    a: P.DAYS_MANAGE,
    b: P.DISCREPANCIES_REVIEW,
    why: "Counts the drawer and also decides on the differences it finds.",
  },
];

export const label = (p: string) => permissionLabels[p as Permission] ?? p;
