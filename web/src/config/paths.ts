/**
 * Every URL in the app lives here, with a label and, where useful, a builder.
 * Components never write path strings by hand, so renaming a route is one edit.
 */
const paths = {
  home: { href: '/', label: 'Home' },
  auth: { login: { href: '/login', label: 'Sign in' } },
  calculator: { href: '/calculator', label: 'Calculator' },
  transactions: {
    list: { href: '/transactions', label: 'Transactions' },
    create: { href: '/transactions/new', label: 'New transaction' },
    detail: { href: '/transactions/:id', to: (id: string) => `/transactions/${encodeURIComponent(id)}`, label: 'Transaction' },
  },
  unauthorized: {
    href: '/unauthorized',
    redirect: (reason: string) => `/unauthorized?reason=${encodeURIComponent(reason)}`,
    label: 'No access',
  },
} as const;

export default paths;
