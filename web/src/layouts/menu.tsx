import type { ReactNode } from 'react';
import { CalculatorIcon, HomeIcon, ListIcon, PlusCircleIcon, ReceiptIcon } from 'lucide-react';
import paths from '@/config/paths';
import { PERMISSIONS, type Permission } from '@/config/permissions';
import type { Role } from '@/features/auth/schemas';
import SidebarLabel from './SidebarLabel';

/**
 * The whole navigation, as data. One list feeds the desktop sidebar, the phone drawer and the bottom tabs.
 * An item with `permission`/`roles` is hidden from anyone without it; a parent with no visible children disappears.
 * The route table stays the real gatekeeper (a test checks the two agree), so hiding a link is never the only protection.
 */
export interface AppMenuItem {
  key: string;
  label: ReactNode;
  /** Plain text for the bottom tab bar. */
  title?: string;
  icon?: ReactNode;
  permission?: Permission;
  roles?: Role[];
  /** Show in the phone bottom tab bar. */
  mobileTab?: boolean;
  type?: 'group' | 'divider';
  children?: AppMenuItem[];
}

const icon = 'size-4';
const link = (href: string, text: string) => <SidebarLabel to={href}>{text}</SidebarLabel>;

export const appMenu: AppMenuItem[] = [
  {
    key: 'group-operations',
    type: 'group',
    label: 'Operations',
    children: [
      { key: paths.home.href, label: link(paths.home.href, paths.home.label), title: paths.home.label, icon: <HomeIcon className={icon} />, mobileTab: true },
      {
        key: paths.calculator.href,
        label: link(paths.calculator.href, paths.calculator.label),
        title: paths.calculator.label,
        icon: <CalculatorIcon className={icon} />,
        permission: PERMISSIONS.CALCULATOR_USE,
        mobileTab: true,
      },
      {
        key: 'transactions',
        label: <SidebarLabel type="span">Transactions</SidebarLabel>,
        icon: <ReceiptIcon className={icon} />,
        permission: PERMISSIONS.TRANSACTIONS_READ,
        children: [
          {
            key: paths.transactions.list.href,
            label: link(paths.transactions.list.href, 'All transactions'),
            title: paths.transactions.list.label,
            icon: <ListIcon className={icon} />,
            permission: PERMISSIONS.TRANSACTIONS_READ,
            mobileTab: true,
          },
          {
            key: paths.transactions.create.href,
            label: link(paths.transactions.create.href, paths.transactions.create.label),
            icon: <PlusCircleIcon className={icon} />,
            permission: PERMISSIONS.TRANSACTIONS_CREATE,
          },
        ],
      },
    ],
  },
];
