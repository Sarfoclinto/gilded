import { lazy, type ReactNode } from "react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import type { Access } from "@/features/auth/access";
import { RequireAccess } from "./guards";

/**
 * The route table is data. Each entry may carry an `access` rule; the table renders the guard for you,
 * so adding a page never means remembering to wrap it. `nav` puts it in the menu (shown only if allowed).
 */
export interface AppRoute {
  path: string;
  element: ReactNode;
  access?: Access;
  nav?: { label: string };
}

const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));
const CalculatorPage = lazy(
  () => import("@/features/calculator/CalculatorPage"),
);
const TransactionsPage = lazy(
  () => import("@/features/transactions/pages/TransactionsPage"),
);
const NewTransactionPage = lazy(
  () => import("@/features/transactions/pages/NewTransactionPage"),
);
const ToPayPage = lazy(() => import("@/features/transactions/pages/ToPayPage"));
const TransactionDetailPage = lazy(
  () => import("@/features/transactions/pages/TransactionDetailPage"),
);
const ReceiptPage = lazy(() => import("@/features/receipt/ReceiptPage"));
const CompanySettingsPage = lazy(
  () => import("@/features/settings/pages/CompanySettingsPage"),
);
const MySettingsPage = lazy(
  () => import("@/features/settings/pages/MySettingsPage"),
);
const DrawerPage = lazy(() => import("@/features/drawer/pages/DrawerPage"));
const OpenDayPage = lazy(() => import("@/features/drawer/pages/OpenDayPage"));
const CloseDayPage = lazy(() => import("@/features/drawer/pages/CloseDayPage"));
const DayHistoryPage = lazy(
  () => import("@/features/drawer/pages/DayHistoryPage"),
);
const GuidePage = lazy(() => import("@/features/guide/pages/GuidePage"));
const GuideArticlePage = lazy(
  () => import("@/features/guide/pages/GuideArticlePage"),
);
const GuideManagePage = lazy(
  () => import("@/features/guide/pages/GuideManagePage"),
);
const GuideEditorPage = lazy(
  () => import("@/features/guide/pages/GuideEditorPage"),
);
const NoteExchangePage = lazy(
  () => import("@/features/drawer/pages/NoteExchangePage"),
);
const DailyAccountPage = lazy(
  () => import("@/features/accounts/pages/DailyAccountPage"),
);
const ChangePasswordPage = lazy(
  () => import("@/features/auth/pages/ChangePasswordPage"),
);
const CustomersPage = lazy(
  () => import("@/features/customers/pages/CustomersPage"),
);
const CustomerDetailPage = lazy(
  () => import("@/features/customers/pages/CustomerDetailPage"),
);
const UsersPage = lazy(() => import("@/features/users/pages/UsersPage"));
const RolesPage = lazy(() => import("@/features/roles/pages/RolesPage"));
const BranchesPage = lazy(
  () => import("@/features/branches/pages/BranchesPage"),
);
const BranchDetailPage = lazy(
  () => import("@/features/branches/pages/BranchDetailPage"),
);
const DiscrepanciesPage = lazy(
  () => import("@/features/review/pages/DiscrepanciesPage"),
);
const SyncReviewPage = lazy(
  () => import("@/features/sync/pages/SyncReviewPage"),
);
const BranchTimelinePage = lazy(
  () => import("@/features/review/pages/BranchTimelinePage"),
);
const PositionPage = lazy(() => import("@/features/review/pages/PositionPage"));
const TransfersPage = lazy(
  () => import("@/features/transfers/pages/TransfersPage"),
);
const NewTransferPage = lazy(
  () => import("@/features/transfers/pages/NewTransferPage"),
);
const TransferDetailPage = lazy(
  () => import("@/features/transfers/pages/TransferDetailPage"),
);
const AuditPage = lazy(() => import("@/features/audit/pages/AuditPage"));
const ImportPage = lazy(() => import("@/features/imports/pages/ImportPage"));
const PriceFeedPage = lazy(
  () => import("@/features/pricefeed/pages/PriceFeedPage"),
);
const PricesPage = lazy(() => import("@/features/prices/pages/PricesPage"));
const GoldMarketPage = lazy(
  () => import("@/features/market/pages/GoldMarketPage"),
);
const PhotosLabPage = lazy(
  () => import("@/features/photos/pages/PhotosLabPage"),
);
const PendingPaymentsPage = lazy(
  () => import("@/features/payments/PendingPaymentsPage"),
);
const DebtsPage = lazy(() => import("@/features/debts/pages/DebtsPage"));
const PhotosPage = lazy(() => import("@/features/photos/pages/PhotosPage"));
const MyPicturesPage = lazy(() => import("@/features/personal/MyPicturesPage"));
const WorkingsPage = lazy(() => import("@/features/workings/WorkingsPage"));
const SheetPage = lazy(() => import("@/features/workings/SheetPage"));
const GroupSheetsPage = lazy(
  () => import("@/features/groupSheets/GroupSheetsPage"),
);
const GroupPage = lazy(() => import("@/features/groupSheets/GroupPage"));
const GroupSheetPage = lazy(
  () => import("@/features/groupSheets/GroupSheetPage"),
);
const LoanPage = lazy(() => import("@/features/debts/pages/LoanPage"));
const CollateralPage = lazy(
  () => import("@/features/debts/pages/CollateralPage"),
);

export const appRoutes: AppRoute[] = [
  {
    path: paths.home.href,
    element: <DashboardPage />,
    nav: { label: paths.home.label },
  },
  {
    path: paths.calculator.href,
    element: <CalculatorPage />,
    access: { permission: PERMISSIONS.CALCULATOR_USE },
    nav: { label: paths.calculator.label },
  },
  {
    path: paths.transactions.list.href,
    element: <TransactionsPage />,
    access: { permission: PERMISSIONS.TRANSACTIONS_READ },
    nav: { label: paths.transactions.list.label },
  },
  {
    path: paths.transactions.create.href,
    element: <NewTransactionPage />,
    access: { permission: PERMISSIONS.TRANSACTIONS_CREATE },
  },
  {
    path: paths.transactions.toPay.href,
    element: <ToPayPage />,
    access: { permission: PERMISSIONS.DAYS_MANAGE },
  },
  {
    path: paths.transactions.detail.href,
    element: <TransactionDetailPage />,
    access: { permission: PERMISSIONS.TRANSACTIONS_READ },
  },
  {
    path: paths.drawer.home.href,
    element: <DrawerPage />,
    access: { permission: PERMISSIONS.DAYS_READ },
    nav: { label: paths.drawer.home.label },
  },
  {
    path: paths.drawer.open.href,
    element: <OpenDayPage />,
    access: { permission: PERMISSIONS.DAYS_MANAGE },
  },
  {
    path: paths.drawer.close.href,
    element: <CloseDayPage />,
    access: { permission: PERMISSIONS.DAYS_MANAGE },
  },
  {
    path: paths.drawer.history.href,
    element: <DayHistoryPage />,
    access: { permission: PERMISSIONS.DAYS_READ },
    nav: { label: paths.drawer.history.label },
  },
  {
    path: paths.drawer.exchange.href,
    element: <NoteExchangePage />,
    access: { permission: PERMISSIONS.NOTES_EXCHANGE },
  },
  {
    path: paths.drawer.account.href,
    element: <DailyAccountPage />,
    access: { permission: PERMISSIONS.DAYS_READ },
    nav: { label: paths.drawer.account.label },
  },
  {
    path: paths.payments.href,
    element: <PendingPaymentsPage />,
    access: { permission: PERMISSIONS.TRANSACTIONS_READ },
  },
  {
    path: paths.debts.href,
    element: <DebtsPage />,
    access: { permission: PERMISSIONS.DEBTS_READ },
  },
  {
    path: paths.photos.href,
    element: <PhotosPage />,
    access: { permission: PERMISSIONS.ATTACHMENTS_LIBRARY },
  },
  {
    path: paths.debts.newLoan.href,
    element: <LoanPage />,
    access: { permission: PERMISSIONS.DEBTS_MANAGE },
  },
  {
    path: paths.collateral.href,
    element: <CollateralPage />,
    access: { permission: PERMISSIONS.DEBTS_READ },
  },
  {
    path: paths.people.customers.href,
    element: <CustomersPage />,
    access: { permission: PERMISSIONS.CUSTOMERS_READ },
  },
  {
    path: paths.people.customer.href,
    element: <CustomerDetailPage />,
    access: { permission: PERMISSIONS.CUSTOMERS_READ },
  },
  {
    path: paths.people.users.href,
    element: <UsersPage />,
    access: { permission: PERMISSIONS.USERS_MANAGE },
  },
  {
    path: paths.people.roles.href,
    element: <RolesPage />,
    access: { permission: PERMISSIONS.USERS_MANAGE },
  },
  {
    path: paths.people.branches.href,
    element: <BranchesPage />,
    access: { permission: PERMISSIONS.BRANCHES_MANAGE },
  },
  {
    path: paths.people.branch.href,
    element: <BranchDetailPage />,
    access: { permission: PERMISSIONS.BRANCHES_MANAGE },
  },
  {
    path: paths.review.cases.href,
    element: <DiscrepanciesPage />,
    access: { permission: PERMISSIONS.DISCREPANCIES_REVIEW },
  },
  {
    path: paths.review.sync.href,
    element: <SyncReviewPage />,
    access: { permission: PERMISSIONS.SYNC_REVIEW },
  },
  {
    path: paths.review.timeline.href,
    element: <BranchTimelinePage />,
    access: { permission: PERMISSIONS.REPORTS_READ },
  },
  {
    path: paths.review.position.href,
    element: <PositionPage />,
    access: { permission: PERMISSIONS.REPORTS_READ },
  },
  {
    path: paths.transfers.list.href,
    element: <TransfersPage />,
    access: { permission: PERMISSIONS.TRANSFERS_READ },
  },
  {
    path: paths.transfers.create.href,
    element: <NewTransferPage />,
    access: { permission: PERMISSIONS.TRANSFERS_CREATE },
  },
  {
    path: paths.transfers.detail.href,
    element: <TransferDetailPage />,
    access: { permission: PERMISSIONS.TRANSFERS_READ },
  },
  {
    path: paths.audit.href,
    element: <AuditPage />,
    access: { permission: PERMISSIONS.AUDIT_READ },
  },
  {
    path: paths.imports.href,
    element: <ImportPage />,
    access: { permission: PERMISSIONS.IMPORTS_MANAGE },
  },
  {
    path: paths.settings.company.href,
    element: <CompanySettingsPage />,
    access: { permission: PERMISSIONS.SETTINGS_MANAGE },
  },
  { path: paths.settings.me.href, element: <MySettingsPage /> },
  { path: paths.guide.home.href, element: <GuidePage /> },
  {
    path: paths.guide.manage.href,
    element: <GuideManagePage />,
    access: { permission: PERMISSIONS.GUIDE_MANAGE },
  },
  {
    path: paths.guide.edit.href,
    element: <GuideEditorPage />,
    access: { permission: PERMISSIONS.GUIDE_MANAGE },
  },
  { path: paths.guide.article.href, element: <GuideArticlePage /> },
  { path: paths.changePassword.href, element: <ChangePasswordPage /> },
  { path: paths.myPictures.href, element: <MyPicturesPage /> },
  {
    path: paths.workings.href,
    element: <WorkingsPage />,
    nav: { label: paths.workings.label },
  },
  { path: paths.workings.sheet.href, element: <SheetPage /> },
  // Group Sheets: no permission here on purpose. Members see their groups whatever their role; the server decides what is shown.
  {
    path: paths.groupSheets.href,
    element: <GroupSheetsPage />,
    nav: { label: paths.groupSheets.label },
  },
  { path: paths.groupSheets.group.href, element: <GroupPage /> },
  { path: paths.groupSheets.sheet.href, element: <GroupSheetPage /> },
  {
    path: paths.priceFeed.href,
    element: <PriceFeedPage />,
    access: { permission: PERMISSIONS.PRICES_APPROVE },
  },
  {
    path: paths.prices.href,
    element: <PricesPage />,
    access: { permission: PERMISSIONS.TRANSACTIONS_READ },
  },
  {
    path: paths.market.href,
    element: <GoldMarketPage />,
    access: { permission: PERMISSIONS.TRANSACTIONS_READ },
  },
  { path: paths.photosLab.href, element: <PhotosLabPage /> },
];

/** Outside the app layout on purpose (no menu, no header). */
export const receiptRoute: AppRoute = {
  path: paths.transactions.receipt.href,
  element: <ReceiptPage />,
  access: { permission: PERMISSIONS.TRANSACTIONS_READ },
};

export const guarded = (r: AppRoute) =>
  r.access ? (
    <RequireAccess access={r.access}>{r.element}</RequireAccess>
  ) : (
    r.element
  );
