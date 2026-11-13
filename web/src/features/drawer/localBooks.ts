import { lineTotal, type DrawerView, type Lines } from "@gold/core";
import type { ClosingPreview, CountBasis, DayState } from "./schemas";

/**
 * "What the books hold", worked out on the device for a closing made with no connection:
 * the last figures the server gave (kept with the day state) plus everything made on this device since.
 *
 * What can change offline is only what can be made offline: purchases (gold in, cash out, money owed to the customer, a debt settled
 * with gold), payouts of two-step purchases, cash in/out and note exchanges. Loans, repayments, transfers and gold held as security
 * need a connection, so those figures stay as last heard.
 */
export interface WaitingEntry {
  id: string;
  type: string;
  payload: unknown;
}

interface PurchasePayload {
  branchId: string;
  collateralId?: string | null;
  items: { top: string; down: string }[];
  payout: {
    payable: string;
    lines: Lines;
    split?: { method: string; amount: string }[];
  };
}
interface PayPayload {
  transactionId: string;
  branchId: string;
  lines: Lines;
}

/** Whole units of the smallest step (weights 4 decimals, money 2), so sums never pick up floating-point dust. */
const toUnits = (text: string | undefined, dp: number) =>
  Math.round(Number(text ?? 0) * 10 ** dp) || 0;
const fromUnits = (n: number, dp: number) => {
  const s = (n / 10 ** dp).toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

export interface LocalBooks {
  preview: ClosingPreview;
  /** A purchase of gold that was held as security was made offline: the held-gold figure may be lower than shown. */
  custodyUncertain: boolean;
}

/**
 * @param state    the server's last day state (must carry `books`; older stored copies do not, and then there is nothing to work from)
 * @param view     the drawer as this device shows it (its balance is the expected cash)
 * @param waiting  everything on this device (and its colleagues' computers) not yet at the server, in the order it was made
 */
export function localBooks(
  state: DayState | null,
  view: Pick<DrawerView, "status" | "dayId" | "balance">,
  waiting: WaitingEntry[],
  branchId: string,
  twoStep: boolean,
  confirmation: { version: string; text: string },
): LocalBooks | null {
  if (!state?.books || view.status !== "open" || !view.dayId || !view.balance)
    return null;
  const applied = new Set(state.appliedIds);
  let top = toUnits(state.books.goodsTop, 4);
  let down = toUnits(state.books.goodsDown, 4);
  let value = toUnits(state.books.goodsValue, 2);
  let debt = toUnits(state.books.debt, 2);
  let payable = toUnits(state.books.payable, 2);
  const custody = toUnits(state.books.custodyTop, 4);
  let custodyUncertain = false;

  for (const e of waiting) {
    if (e.type === "transaction.create") {
      const p = e.payload as PurchasePayload;
      if (p.branchId !== branchId || applied.has(e.id)) continue;
      for (const it of p.items) {
        top += toUnits(it.top, 4);
        down += toUnits(it.down, 4);
      }
      const amount = toUnits(p.payout.payable, 2);
      value += amount;
      let other = 0;
      for (const part of p.payout.split ?? []) {
        const a = toUnits(part.amount, 2);
        other += a;
        if (part.method === "owed")
          payable += a; // the branch will owe the customer this
        else if (part.method === "debt_offset") debt -= a; // the customer's debt is settled with gold
        // mobile money is not in the books until it is confirmed
      }
      // Two-step payout: saving the purchase means the cash is owed until someone hands it over.
      if (twoStep) payable += Math.max(0, amount - other);
      if (p.collateralId) custodyUncertain = true;
    } else if (e.type === "transaction.pay") {
      const p = e.payload as PayPayload;
      if (p.branchId !== branchId || applied.has(p.transactionId)) continue;
      payable -= lineTotal(p.lines) * 100;
    }
  }

  const cash: Lines = Object.fromEntries(
    Object.entries(view.balance).filter(([, n]) => n !== 0),
  );
  return {
    custodyUncertain,
    preview: {
      dayId: view.dayId,
      branchId,
      expected: {
        cash: { lines: cash, value: String(lineTotal(cash)) },
        goodsTop: fromUnits(top, 4),
        goodsDown: fromUnits(down, 4),
        goodsValue: fromUnits(value, 2),
        debt: fromUnits(debt, 2),
        payable: fromUnits(payable, 2),
        custodyTop: fromUnits(custody, 4),
      },
      pendingPayments: 0,
      confirmation,
      asOf: state.asOf,
    },
  };
}

/** What the person was shown, to send with the count. */
export function basisOf(preview: ClosingPreview): CountBasis {
  const e = preview.expected;
  return {
    cash: e.cash.lines,
    goodsTop: e.goodsTop,
    goodsDown: e.goodsDown,
    goodsValue: e.goodsValue,
    debt: e.debt,
    payable: e.payable,
    custodyTop: e.custodyTop,
    asOf: preview.asOf,
  };
}

// ---- The confirmation wording, kept for when there is no connection to ask for it ----------------------------------------------

const KEY = "gold.closingConfirmation.v1";
/** The wording in use when this version was built. Only used on a device that has never loaded a closing while online. */
export const FALLBACK_CONFIRMATION = {
  version: "v3",
  text:
    "I confirm that I have physically verified and accounted for the cash, the total top weight, the total down weight, " +
    "the value of goods, the debts owed to the branch, the amounts the branch owes, and the unrefined gold held as security, " +
    "as reported above. I understand that every difference I report is recorded and will be reviewed.",
};

export function rememberConfirmation(c: { version: string; text: string }) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: c.version, text: c.text }),
    );
  } catch {
    /* storage blocked: the built-in wording applies */
  }
}

export function knownConfirmation(): { version: string; text: string } {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
      version?: unknown;
      text?: unknown;
    } | null;
    if (
      c &&
      typeof c.version === "string" &&
      typeof c.text === "string" &&
      c.text.length > 20
    )
      return { version: c.version, text: c.text };
  } catch {
    /* fall through */
  }
  return FALLBACK_CONFIRMATION;
}
