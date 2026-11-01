import type { Settings } from "./api";

/**
 * The company settings screen is drawn from this list, so a new setting is one entry here (and one key on the server),
 * and a new group of settings is one more section: it becomes a new tab by itself.
 */
export type FieldKind = "toggle" | "number" | "text" | "choice";

export interface Field {
  key: keyof Settings;
  kind: FieldKind;
  label: string;
  help?: string;
  /** Another toggle that has to be on for this one to apply; until then this one is shown but switched off. */
  needs?: keyof Settings;
  choices?: Array<{ value: string; label: string }>;
  placeholder?: string;
  unit?: string;
  max?: number;
  /** Asks for confirmation before it can be saved as turned on. */
  confirmOn?: string;
}

export interface Section {
  key: string;
  title: string;
  /** One line under the tab, saying what this group is for. */
  blurb: string;
  fields: Field[];
  /** Show the sample receipt beside the fields. */
  preview?: boolean;
}

export const SECTIONS: Section[] = [
  {
    key: "payout",
    title: "Paying customers",
    blurb: "How the cash gets from the drawer to the customer.",
    fields: [
      {
        key: "payout.twoStep",
        kind: "toggle",
        label: "Two-step payout",
        help: 'One person weighs and saves the purchase; another pays the cash out from the "To pay" list. Off: the cash is paid out when the purchase is saved.',
        confirmOn:
          "Switch on two-step payout? Do it when no purchase is waiting to be sent from anyone's device, so nothing is saved one way and paid the other.",
      },
      {
        key: "payout.sameUserMayPay",
        kind: "toggle",
        label: "The person who saved a purchase may also pay it",
        help: "Leave on for a branch with one worker. Switch off to make sure a second person always hands the cash over.",
        needs: "payout.twoStep",
      },
      {
        key: "payout.blindCheck",
        kind: "toggle",
        label: "Payer must re-check the weights",
        help: "Before paying, the person enters top, down and price again. If the amount differs from the recorded one the payment is stopped and reviewers are told.",
        needs: "payout.twoStep",
      },
    ],
  },
  {
    key: "receipts",
    title: "Receipts",
    blurb: "What the customer receives, with or without a receipt printer.",
    fields: [
      {
        key: "receipt.printer",
        kind: "toggle",
        label: "This company uses a receipt printer",
        help: "On: after a purchase is saved the receipt opens ready to print. Off: the receipt can still be viewed and printed from the purchase whenever it is wanted.",
      },
      {
        key: "receipt.paper",
        kind: "choice",
        label: "Paper",
        help: "The default for every desk. Each person can choose another for their own desk in My settings.",
        choices: [
          { value: "80", label: "Roll, 80 mm" },
          { value: "58", label: "Roll, 58 mm" },
          { value: "a4", label: "A4 sheet" },
        ],
      },
    ],
    preview: true,
  },
  {
    key: "business",
    title: "Business details",
    blurb:
      "The name and contact details printed at the top and bottom of every receipt.",
    fields: [
      {
        key: "receipt.businessName",
        kind: "text",
        label: "Business name",
        placeholder: "e.g. Golden Fleece Buyers",
        max: 60,
      },
      {
        key: "receipt.tagline",
        kind: "text",
        label: "Line under the name",
        placeholder: "e.g. Gold purchase receipt",
        max: 60,
      },
      {
        key: "receipt.address",
        kind: "text",
        label: "Address",
        placeholder: "Street, town",
        max: 120,
      },
      {
        key: "receipt.phone",
        kind: "text",
        label: "Phone",
        placeholder: "024 000 0000",
        max: 40,
      },
      {
        key: "receipt.footer",
        kind: "text",
        label: "Footer message",
        placeholder: "e.g. Keep this receipt. Thank you.",
        max: 120,
      },
    ],
    preview: true,
  },
  {
    key: "cash",
    title: "Cash and allowance",
    blurb: "Rules for money that moves in and out of the drawer.",
    fields: [
      {
        key: "count.blind",
        kind: "toggle",
        label: "Count the drawer without seeing the books",
        help: "When opening and closing, the screen does not show what the books say the drawer should hold. If the count does not match, the teller is told only then (without the amount) and must recount or write why. The drawer page still shows the running balance, because paying out needs it.",
      },
      {
        key: "allowance.perPerson",
        kind: "number",
        label: "Office allowance per person",
        help: "Paid out of the day's cash for each person at the branch. Used when recording the allowance on the cash drawer.",
        unit: "GHS",
        max: 10000,
      },
    ],
  },
];

export type Draft = Partial<Settings>;

/** What the person has changed from what is saved. Only these keys are sent. */
export function changes(saved: Settings, draft: Draft): Draft {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft))
    if (v !== undefined && v !== saved[k as keyof Settings]) out[k] = v;
  return out as Draft;
}

/** The value shown: the draft where one was typed, else what is saved. */
export const valueOf = <K extends keyof Settings>(
  saved: Settings,
  draft: Draft,
  key: K,
): Settings[K] => (key in draft ? (draft[key] as Settings[K]) : saved[key]);

/** Which sections have unsaved changes, so their tabs can say so. */
export function dirtySections(saved: Settings, draft: Draft): Set<string> {
  const changed = changes(saved, draft);
  return new Set(
    SECTIONS.filter((s) => s.fields.some((f) => f.key in changed)).map(
      (s) => s.key,
    ),
  );
}

/** A number box holds text while typing; this is the whole number it means, or null while it is not one. */
export function wholeNumber(text: string, max: number): number | null {
  if (!/^\d{1,6}$/.test(text.trim())) return null;
  const n = Number(text);
  return n <= max ? n : null;
}
