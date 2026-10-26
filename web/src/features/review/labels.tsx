import { Chip, type ChipTone } from "@/shared/ui/Chip";
import type { CaseStatus } from "./schemas";

export const caseStatusLabel: Record<CaseStatus, string> = {
  open: "Open",
  under_review: "Being looked at",
  resolved: "Resolved",
  written_off: "Written off",
};
const tone: Record<CaseStatus, ChipTone> = {
  open: "amber",
  under_review: "sky",
  resolved: "green",
  written_off: "grey",
};
export const CaseStatusChip = ({ status }: { status: CaseStatus }) => (
  <Chip tone={tone[status]}>{caseStatusLabel[status]}</Chip>
);

export const kindLabel: Record<string, string> = {
  opening_variance: "Opening count differed",
  closing_variance: "Closing count differed",
  transfer_receipt: "Transfer received with a difference",
  other: "Other",
};
export const assetLabel: Record<string, string> = {
  cash: "Cash",
  goods_top: "Gold (top weight)",
  goods_down: "Gold (in water)",
  goods_value: "Gold (value)",
  debt: "Debts",
  payable: "Amounts we owe",
  custody_top: "Held gold",
};
export const resolutionLabel: Record<string, string> = {
  explained: "Explained, nothing missing",
  found: "Found",
  recovered: "Recovered",
  corrected_entry: "A mistaken entry was corrected",
  written_off: "Written off as a loss",
};
export const actionLabel: Record<string, string> = {
  opened: "Opened",
  note: "Note",
  assigned: "Taken over",
  status_changed: "Status changed",
  adjustment_posted: "Adjustment posted",
  evidence_added: "Evidence added",
  resolved: "Resolved",
  reopened: "Reopened",
};
export const sourceLabel: Record<string, string> = {
  go_live_balance: "Starting balance",
  transaction_purchase: "Purchase",
  transaction_payout: "Purchase payout",
  drawer_movement: "Drawer movement",
  transfer_release: "Transfer sent",
  transfer_receipt: "Transfer received",
  transfer_payment: "Transfer payment",
  debt_issued: "Loan given",
  debt_repayment: "Debt repayment",
  opening_adjustment: "Opening adjustment",
  closing_adjustment: "Closing adjustment",
  discrepancy_resolution: "Case resolution",
  reversal: "Reversal",
  payable_settlement: "Amount we owed, settled",
};
