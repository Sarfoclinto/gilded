/**
 * Every URL in the app lives here, with a label and, where useful, a builder.
 * Components never write path strings by hand, so renaming a route is one edit.
 */
const paths = {
  home: { href: "/", label: "Home" },
  auth: { login: { href: "/login", label: "Sign in" } },
  calculator: { href: "/calculator", label: "Calculator" },
  transactions: {
    list: { href: "/transactions", label: "Transactions" },
    create: { href: "/transactions/new", label: "New transaction" },
    /** Purchases saved but not yet paid out (two-step payout). */
    toPay: { href: "/transactions/to-pay", label: "To pay" },
    /** Buy the refined result of gold held as loan security. */
    createFromHeld: {
      to: (collateralId: string) =>
        `/transactions/new?collateral=${encodeURIComponent(collateralId)}`,
      label: "Refine and buy",
    },
    receipt: {
      href: "/transactions/:id/receipt",
      to: (id: string, query = "") =>
        `/transactions/${encodeURIComponent(id)}/receipt${query}`,
      label: "Receipt",
    },
    detail: {
      href: "/transactions/:id",
      to: (id: string) => `/transactions/${encodeURIComponent(id)}`,
      label: "Transaction",
    },
  },
  drawer: {
    home: { href: "/drawer", label: "Cash drawer" },
    open: { href: "/drawer/open", label: "Open the day" },
    close: { href: "/drawer/close", label: "Close the day" },
    history: { href: "/drawer/history", label: "Day history" },
    account: { href: "/drawer/account", label: "Daily account" },
  },
  prices: { href: "/prices", label: "Prices" },
  priceFeed: { href: "/prices/feed", label: "Automatic price" },
  people: {
    customers: { href: "/people/customers", label: "Customers" },
    customer: {
      href: "/people/customers/:id",
      to: (id: string) => `/people/customers/${encodeURIComponent(id)}`,
      label: "Customer",
    },
    users: { href: "/people/users", label: "Users" },
    roles: { href: "/people/roles", label: "Roles" },
    branches: { href: "/people/branches", label: "Branches" },
    branch: {
      href: "/people/branches/:id",
      to: (id: string) => `/people/branches/${encodeURIComponent(id)}`,
      label: "Branch",
    },
  },
  review: {
    cases: { href: "/review/cases", label: "Differences" },
    timeline: { href: "/review/timeline", label: "Branch timeline" },
    position: { href: "/review/position", label: "Between branches" },
  },
  transfers: {
    list: { href: "/transfers", label: "Transfers" },
    create: { href: "/transfers/new", label: "New transfer" },
    detail: {
      href: "/transfers/:id",
      to: (id: string) => `/transfers/${encodeURIComponent(id)}`,
      label: "Transfer",
    },
  },
  audit: { href: "/setup/audit", label: "Audit trail" },
  imports: { href: "/setup/import", label: "Bring in data" },
  changePassword: { href: "/change-password", label: "Choose a new password" },
  payments: { href: "/payments", label: "Mobile money" },
  debts: { href: "/debts", label: "Debts and loans" },
  collateral: { href: "/collateral", label: "Held gold" },
  unauthorized: {
    href: "/unauthorized",
    redirect: (reason: string) =>
      `/unauthorized?reason=${encodeURIComponent(reason)}`,
    label: "No access",
  },
} as const;

export default paths;
