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
    /** Buy the refined result of gold held as loan security. */
    createFromHeld: {
      to: (collateralId: string) =>
        `/transactions/new?collateral=${encodeURIComponent(collateralId)}`,
      label: "Refine and buy",
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
  },
  prices: { href: "/prices", label: "Prices" },
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
