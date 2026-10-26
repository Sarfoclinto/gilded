import { Chip, type ChipTone } from "@/shared/ui/Chip";
import type { TransferStatus } from "./schemas";

export const statusLabel: Record<TransferStatus, string> = {
  draft: "Draft",
  released: "On the way",
  received: "Received",
  received_with_discrepancy: "Received, with differences",
  cancelled: "Cancelled",
};

const tone: Record<TransferStatus, ChipTone> = {
  draft: "grey",
  released: "sky",
  received: "green",
  received_with_discrepancy: "amber",
  cancelled: "grey",
};

export function StatusChip({ status }: { status: TransferStatus }) {
  return <Chip tone={tone[status]}>{statusLabel[status]}</Chip>;
}

export const purposeLabel: Record<string, string> = {
  stock_collection: "Collecting gold",
  restock_funding: "Money to restock",
  cash_return: "Cash going back",
  payment_on_collection: "Payment on collection",
  other: "Other",
};

export const methodLabel: Record<string, string> = {
  collector_from_destination: "Collector from the receiving branch",
  staff_travelling: "Staff travelling",
  designated_courier: "Courier",
  branch_delivery: "Delivered by the branch",
  other: "Other",
};

export const eventLabel: Record<string, string> = {
  created: "Started",
  goods_added: "Gold added",
  goods_removed: "Gold taken off",
  collector_set: "Collector set",
  released: "Handed to the collector",
  payment_recorded: "Money recorded",
  received: "Received",
  discrepancy_flagged: "Difference flagged",
  note_added: "Note",
  cancelled: "Cancelled",
  attachment_added: "File added",
};

export const outcomeLabel: Record<string, string> = {
  pending: "Waiting",
  matched: "Matched",
  differs: "Differs",
  missing: "Did not arrive",
};
