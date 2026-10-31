import type { TransactionView } from "@/features/transactions/view";

/** A made-up purchase, to show what a receipt will look like while its details are being set. Never saved. */
export const SAMPLE_PURCHASE: TransactionView = {
  id: "sample",
  branchId: "sample",
  reference: "TKW-20261031-0007",
  customerName: "Kwame Mensah",
  customerPhone: "024 000 0000",
  items: [
    {
      id: "i1",
      label: "Ring",
      top: "7.77",
      down: "0.41",
      price: "11650",
      result: {
        density: "18",
        karat: "22",
        purity: "0.9167",
        netWeight: "7.5",
        pounds: "1",
        amount: "11830",
      },
    },
  ],
  calculatedAmount: "11830",
  payout: {
    payable: "11830",
    difference: "0",
    lines: { "100": 118, "20": 1, "10": 1 },
    totalNotes: 120,
    stage: "paid",
    cashDue: "0",
    suggestedLines: null,
    paidBy: null,
    paidAt: null,
  },
  payments: [
    { id: "p1", method: "cash", amount: "11830", status: "confirmed" },
  ],
  customerId: null,
  representative: null,
  capturedAt: new Date(2026, 9, 31, 10, 30).toISOString(),
  status: "saved",
  flags: [],
  sync: "synced",
  createdBy: "Ama Teller",
};
