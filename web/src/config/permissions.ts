/**
 * Permission keys, `resource:action`. The API owns who has what; the UI only hides what a person cannot do.
 * Keep this file and the backend's list (Application/Auth/Permissions.cs) in step.
 */
export const PERMISSIONS = {
  CALCULATOR_USE: "calculator:use",
  TRANSACTIONS_READ: "transactions:read",
  TRANSACTIONS_CREATE: "transactions:create",
  DAYS_READ: "days:read",
  DAYS_MANAGE: "days:manage",
  DAYS_SIGNOFF: "days:signoff",
  PRICES_APPROVE: "prices:approve",
  KUMASI_SET_VALUE: "kumasi:set-value",
  REPORTS_READ: "reports:read",
  USERS_MANAGE: "users:manage",
  DEBTS_READ: "debts:read",
  DEBTS_MANAGE: "debts:manage",
  PAYMENTS_CONFIRM: "payments:confirm",
  BRANCHES_ALL: "branches:all",
  CUSTOMERS_READ: "customers:read",
  CUSTOMERS_MANAGE: "customers:manage",
  BRANCHES_MANAGE: "branches:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
