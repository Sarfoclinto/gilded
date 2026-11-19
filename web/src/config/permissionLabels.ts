import type { Permission } from "./permissions";

/** Plain words for each permission, for the screen where a director gives someone extra access or takes some away. */
export const permissionLabels: Record<Permission, string> = {
  "calculator:use": "Use the calculator",
  "transactions:read": "See purchases",
  "transactions:create": "Record purchases",
  "days:read": "See the cash drawer and days",
  "days:manage": "Open and close the day, top up the drawer",
  "days:signoff": "Sign off days that closed with differences",
  "prices:approve": "Approve branch prices and margins",
  "kumasi:set-value": "Publish the reference price and set margins",
  "reports:read": "See reports",
  "users:manage": "Manage users",
  "debts:read": "See debts, loans and held gold",
  "debts:manage": "Lend, record repayments, hand back held gold",
  "payments:confirm": "Confirm mobile money this branch sent",
  "branches:all": "Work in every branch",
  "customers:read": "See customers",
  "customers:manage": "Add and edit customers, merge duplicates",
  "branches:manage": "Add and switch off branches",
  "transfers:read": "See transfers between branches",
  "transfers:create": "Prepare, send and pay for transfers (sending end)",
  "discrepancies:review":
    "Work the inbox of differences (take, note, resolve, reopen)",
  "transactions:cancel":
    "Cancel a wrongly saved purchase, with a reason: the gold and the cash are put back; the original is kept",
  "attachments:library":
    "Open the Photos page: every picture from the branches you can see, with filters",
  "attachments:ids":
    "See customers' ID pictures (each time one is opened, the audit trail records who and when)",
  "attachments:remove":
    "Take other people's photos off the screen (the record of them is kept)",
  "notes:exchange":
    "Change notes for the branch itself: smaller notes for change, bigger notes to hand out fewer",
  "sync:review":
    "Review offline entries that could not be applied, then retry or dismiss them",
  "groups:create":
    "Create Group Sheets groups (private running records such as kitchen fees). It opens no other group",
  "guide:manage":
    "Write and publish the business rules and guides, and set reminders to read them",
  "settings:manage":
    "Change company settings: two-step payout, receipts, the office allowance",
  "audit:read": "Read the audit trail: who did what, when and where",
  "imports:manage":
    "Bring in customers and past purchases from spreadsheets, and undo an import",
  "transfers:receive":
    "Receive transfers and confirm what arrived (receiving end)",
};

export const allPermissions = Object.keys(permissionLabels) as Permission[];
