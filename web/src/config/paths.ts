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
    exchange: { href: "/drawer/exchange", label: "Change notes" },
  },
  prices: { href: "/prices", label: "Prices" },
  /** The world's live gold price, our own price over time and what we bought. */
  market: { href: "/market", label: "Gold market" },
  /** A try-out page for the camera and photo sending (B60 spike). Not in the menu. */
  photosLab: { href: "/photos-lab", label: "Photos lab" },
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
    sync: { href: "/sync/review", label: "Offline entries" },
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
  guide: {
    home: { href: "/guide", label: "Rules and guides" },
    article: {
      href: "/guide/:id",
      to: (id: string) => `/guide/${encodeURIComponent(id)}`,
      label: "Guide",
    },
    manage: { href: "/guide/manage", label: "Write the guide" },
    edit: {
      href: "/guide/manage/:id",
      to: (id: string) => `/guide/manage/${encodeURIComponent(id)}`,
      label: "Edit an article",
    },
  },
  audit: { href: "/setup/audit", label: "Audit trail" },
  imports: { href: "/setup/import", label: "Bring in data" },
  settings: {
    /** The company's settings, for whoever manages the company. */
    company: { href: "/settings/company", label: "Company settings" },
    /** Each person's own settings. */
    me: { href: "/settings/me", label: "My settings" },
  },
  changePassword: { href: "/change-password", label: "Choose a new password" },
  payments: { href: "/payments", label: "Mobile money" },
  debts: {
    href: "/debts",
    label: "Debts and loans",
    newLoan: { href: "/debts/new-loan", label: "Give a loan" },
  },
  collateral: { href: "/collateral", label: "Held gold" },
  photos: { href: "/photos", label: "Photos" },
  unauthorized: {
    href: "/unauthorized",
    redirect: (reason: string) =>
      `/unauthorized?reason=${encodeURIComponent(reason)}`,
    label: "No access",
  },
} as const;

export default paths;
