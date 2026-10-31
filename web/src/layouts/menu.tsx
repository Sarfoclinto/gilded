import type { ReactNode } from "react";
import {
  CalculatorIcon,
  CoinsIcon,
  HandCoinsIcon,
  BuildingIcon,
  HistoryIcon,
  HomeIcon,
  TruckIcon,
  ScaleIcon,
  SearchCheckIcon,
  ScrollTextIcon,
  UserCogIcon,
  UsersIcon,
  ListIcon,
  PlusCircleIcon,
  ReceiptIcon,
  SmartphoneIcon,
  RefreshCwIcon,
  TagIcon,
  UploadIcon,
  WalletIcon,
  ShieldCheckIcon,
  KeyRoundIcon,
  SettingsIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS, type Permission } from "@/config/permissions";
import type { Role } from "@/features/auth/schemas";
import SidebarLabel from "./SidebarLabel";

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
  type?: "group" | "divider";
  children?: AppMenuItem[];
}

const icon = "size-4";
const link = (href: string, text: string) => (
  <SidebarLabel to={href}>{text}</SidebarLabel>
);

export const appMenu: AppMenuItem[] = [
  {
    key: "group-operations",
    type: "group",
    label: "Operations",
    children: [
      {
        key: paths.home.href,
        label: link(paths.home.href, paths.home.label),
        title: paths.home.label,
        icon: <HomeIcon className={icon} />,
        mobileTab: true,
      },
      {
        key: paths.calculator.href,
        label: link(paths.calculator.href, paths.calculator.label),
        title: paths.calculator.label,
        icon: <CalculatorIcon className={icon} />,
        permission: PERMISSIONS.CALCULATOR_USE,
        mobileTab: true,
      },
      {
        key: "transactions",
        label: <SidebarLabel type="span">Transactions</SidebarLabel>,
        icon: <ReceiptIcon className={icon} />,
        permission: PERMISSIONS.TRANSACTIONS_READ,
        children: [
          {
            key: paths.transactions.list.href,
            label: link(paths.transactions.list.href, "All transactions"),
            title: paths.transactions.list.label,
            icon: <ListIcon className={icon} />,
            permission: PERMISSIONS.TRANSACTIONS_READ,
            mobileTab: true,
          },
          {
            key: paths.transactions.toPay.href,
            label: link(
              paths.transactions.toPay.href,
              paths.transactions.toPay.label,
            ),
            icon: <HandCoinsIcon className={icon} />,
            permission: PERMISSIONS.DAYS_MANAGE,
          },
          {
            key: paths.transactions.create.href,
            label: link(
              paths.transactions.create.href,
              paths.transactions.create.label,
            ),
            icon: <PlusCircleIcon className={icon} />,
            permission: PERMISSIONS.TRANSACTIONS_CREATE,
          },
        ],
      },
      {
        key: paths.people.customers.href,
        label: link(paths.people.customers.href, paths.people.customers.label),
        title: paths.people.customers.label,
        icon: <UsersIcon className={icon} />,
        permission: PERMISSIONS.CUSTOMERS_READ,
      },
    ],
  },
  {
    key: "group-transfers",
    type: "group",
    label: "Between branches",
    children: [
      {
        key: paths.transfers.list.href,
        label: link(paths.transfers.list.href, paths.transfers.list.label),
        title: paths.transfers.list.label,
        icon: <TruckIcon className={icon} />,
        permission: PERMISSIONS.TRANSFERS_READ,
      },
    ],
  },
  {
    key: "group-review",
    type: "group",
    label: "Review",
    children: [
      {
        key: paths.review.cases.href,
        label: link(paths.review.cases.href, paths.review.cases.label),
        title: paths.review.cases.label,
        icon: <SearchCheckIcon className={icon} />,
        permission: PERMISSIONS.DISCREPANCIES_REVIEW,
      },
      {
        key: paths.review.timeline.href,
        label: link(paths.review.timeline.href, paths.review.timeline.label),
        title: paths.review.timeline.label,
        icon: <ScrollTextIcon className={icon} />,
        permission: PERMISSIONS.REPORTS_READ,
      },
      {
        key: paths.review.position.href,
        label: link(paths.review.position.href, paths.review.position.label),
        title: paths.review.position.label,
        icon: <ScaleIcon className={icon} />,
        permission: PERMISSIONS.REPORTS_READ,
      },
    ],
  },
  {
    key: "group-cash",
    type: "group",
    label: "Cash",
    children: [
      {
        key: paths.drawer.home.href,
        label: link(paths.drawer.home.href, paths.drawer.home.label),
        title: paths.drawer.home.label,
        icon: <WalletIcon className={icon} />,
        permission: PERMISSIONS.DAYS_READ,
        mobileTab: true,
      },
      {
        key: paths.drawer.history.href,
        label: link(paths.drawer.history.href, paths.drawer.history.label),
        icon: <HistoryIcon className={icon} />,
        permission: PERMISSIONS.DAYS_READ,
      },
      {
        key: paths.drawer.account.href,
        label: link(paths.drawer.account.href, paths.drawer.account.label),
        icon: <ScrollTextIcon className={icon} />,
        permission: PERMISSIONS.DAYS_READ,
      },
    ],
  },
  {
    key: "group-money",
    type: "group",
    label: "Money",
    children: [
      {
        key: paths.payments.href,
        label: link(paths.payments.href, paths.payments.label),
        title: paths.payments.label,
        icon: <SmartphoneIcon className={icon} />,
        permission: PERMISSIONS.TRANSACTIONS_READ,
      },
      {
        key: paths.debts.href,
        label: link(paths.debts.href, paths.debts.label),
        title: paths.debts.label,
        icon: <HandCoinsIcon className={icon} />,
        permission: PERMISSIONS.DEBTS_READ,
      },
      {
        key: paths.collateral.href,
        label: link(paths.collateral.href, paths.collateral.label),
        title: paths.collateral.label,
        icon: <CoinsIcon className={icon} />,
        permission: PERMISSIONS.DEBTS_READ,
      },
    ],
  },
  {
    key: "group-setup",
    type: "group",
    label: "Setup",
    children: [
      {
        key: paths.prices.href,
        label: link(paths.prices.href, paths.prices.label),
        title: paths.prices.label,
        icon: <TagIcon className={icon} />,
        permission: PERMISSIONS.TRANSACTIONS_READ,
      },
      {
        key: paths.priceFeed.href,
        label: link(paths.priceFeed.href, paths.priceFeed.label),
        title: paths.priceFeed.label,
        icon: <RefreshCwIcon className={icon} />,
        permission: PERMISSIONS.PRICES_APPROVE,
      },
      {
        key: paths.people.users.href,
        label: link(paths.people.users.href, paths.people.users.label),
        title: paths.people.users.label,
        icon: <UserCogIcon className={icon} />,
        permission: PERMISSIONS.USERS_MANAGE,
      },
      {
        key: paths.people.roles.href,
        label: link(paths.people.roles.href, paths.people.roles.label),
        title: paths.people.roles.label,
        icon: <KeyRoundIcon className={icon} />,
        permission: PERMISSIONS.USERS_MANAGE,
      },
      {
        key: paths.people.branches.href,
        label: link(paths.people.branches.href, paths.people.branches.label),
        title: paths.people.branches.label,
        icon: <BuildingIcon className={icon} />,
        permission: PERMISSIONS.BRANCHES_MANAGE,
      },
      {
        key: paths.settings.company.href,
        label: link(paths.settings.company.href, paths.settings.company.label),
        title: paths.settings.company.label,
        icon: <SettingsIcon className={icon} />,
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
      {
        key: paths.audit.href,
        label: link(paths.audit.href, paths.audit.label),
        title: paths.audit.label,
        icon: <ShieldCheckIcon className={icon} />,
        permission: PERMISSIONS.AUDIT_READ,
      },
      {
        key: paths.imports.href,
        label: link(paths.imports.href, paths.imports.label),
        title: paths.imports.label,
        icon: <UploadIcon className={icon} />,
        permission: PERMISSIONS.IMPORTS_MANAGE,
      },
    ],
  },
];
