export const commandLabel: Record<string, string> = {
  "transaction.create": "Purchase",
  "transaction.pay": "Payout",
  "drawer.movement": "Cash in or out",
  "drawer.exchange": "Note exchange",
  "day.open": "Open the day",
  "day.close": "Close the day",
};

export const statusLabel: Record<string, string> = {
  held: "Waiting",
  rejected: "Needs a decision",
};

export const flagLabel: Record<string, string> = {
  offline: "Made offline",
  "very-late": "More than a day late",
  "already-recorded": "Already recorded",
  duplicate: "Already recorded",
  reviewed: "Reviewed",
};
