import Decimal from "decimal.js";

/**
 * Workings: a freeform scratch sheet. Each note is one line of text placed anywhere. The text is the whole truth of the note:
 *   "Weight 12.4 g"        a labelled figure (label "Weight", value 12.4, unit g)
 *   "1,210"                a bare figure
 *   "rent"                 a plain note with no figure
 *   "= Weight × Price"     a result: a formula over other notes, by their labels
 *   "Total = Weight × 2"   a result with its own label, so other formulas can use it
 * Nothing here touches the books: this is paper that does the arithmetic. Money-safe decimals throughout; no hidden rounding (results are
 * kept exactly and shown to at most four places unless round() is asked for).
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof D>;

export interface WorkingNote {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface WorkingDoc {
  notes: WorkingNote[];
  view?: { x: number; y: number; zoom: number };
}

/** What a note says, read from its text. */
export interface ParsedNote {
  kind: "figure" | "text" | "formula";
  label?: string;
  value?: string;
  unit?: string;
  /** The formula source, without the leading "=". */
  formula?: string;
}

/** A note's value once the sheet is worked out. */
export interface NoteResult {
  value?: string;
  unit?: string;
  error?: string;
  /** Ids of the notes this one reads (so a screen can draw the arrows). */
  uses: string[];
}

/** Things the sheet can use that come from outside: the price of the day (GHS per gram) if the person has one. */
export interface WorkingEnv {
  pricePerGram?: string | null;
}

const UNITS = ["g", "kg", "oz", "ghs", "%", "k", "karat", "kt", "pcs"] as const;
const unitOf = (raw: string): string | undefined => {
  const u = raw
    .trim()
    .replace(/^GH[S₵]$/i, "GHS")
    .replace(/^₵$/, "GHS");
  if (!u) return undefined;
  const low = u.toLowerCase();
  if (low === "ghs" || low === "cedis" || low === "cedi") return "GHS";
  if (low === "k" || low === "kt" || low === "karat" || low === "karats")
    return "karat";
  if ((UNITS as readonly string[]).includes(low)) return low;
  return u.length <= 6 ? u : undefined;
};

const NUMBER = /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|-?\.\d+/;
const FIGURE_LINE = new RegExp(
  `^(.*?)\\s*[:=]?\\s*(${NUMBER.source})\\s*([A-Za-z%₵/]{0,8})\\s*$`,
);

/** Read one note's text. Never throws: anything odd is just a text note. */
export function parseNote(text: string): ParsedNote {
  const t = text.trim();
  if (!t) return { kind: "text" };
  const eq = t.indexOf("=");
  if (eq >= 0 && !/\d\s*=/.test(t.slice(0, eq + 1))) {
    const label = t.slice(0, eq).trim();
    const formula = t.slice(eq + 1).trim();
    // "Weight = 12.4 g" is a figure written with an equals sign, not a formula
    const fig = new RegExp(`^(${NUMBER.source})\\s*([A-Za-z%₵/]{0,8})$`).exec(
      formula,
    );
    if (fig && label) {
      const unit = unitOf(fig[2] ?? "");
      if (!fig[2] || unit)
        return {
          kind: "figure",
          label,
          value: fig[1]!.replace(/,/g, ""),
          unit,
        };
    }
    if (formula) return { kind: "formula", label: label || undefined, formula };
  }
  const m = FIGURE_LINE.exec(t);
  if (m) {
    const label = m[1]
      ?.trim()
      .replace(/[:\-–]$/, "")
      .trim();
    const unit = unitOf(m[3] ?? "");
    if (m[3] && !unit) return { kind: "text", label: t };
    return {
      kind: "figure",
      label: label || undefined,
      value: m[2]!.replace(/,/g, ""),
      unit,
    };
  }
  return { kind: "text", label: t };
}

// ---------------------------------------------------------------------------------------------------------------------
// Formulas

type Tok =
  | { t: "num"; v: string; pct: boolean }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "[") {
      const j = s.indexOf("]", i);
      if (j < 0) throw new Error("A [ has no closing ].");
      out.push({ t: "id", v: s.slice(i + 1, j).trim() });
      i = j + 1;
      continue;
    }
    const num = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      let pct = false;
      if (s[i] === "%") {
        pct = true;
        i++;
      }
      out.push({ t: "num", v: num[0].replace(/,/g, ""), pct });
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_']*(?:\s+[A-Za-z_][A-Za-z0-9_']*)*/.exec(
      s.slice(i),
    );
    if (id) {
      // an identifier may be several words ("Total payable"); words that are functions stop before "("
      out.push({ t: "id", v: id[0].trim() });
      i += id[0].length;
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: ")" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ t: "," });
      i++;
      continue;
    }
    throw new Error(`"${c}" is not something a formula understands.`);
  }
  return out;
}

type Node =
  | { k: "num"; v: string; pct: boolean }
  | { k: "ref"; name: string }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "neg"; a: Node }
  | { k: "call"; fn: string; args: Node[] };

const FUNCTIONS = [
  "sum",
  "avg",
  "average",
  "min",
  "max",
  "round",
  "purity",
  "pure",
  "abs",
] as const;

/** Parse a formula into a tree. Throws a plain-language Error. */
export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expr = (): Node => {
    let a = term();
    while (
      peek()?.t === "op" &&
      ["+", "-"].includes((peek() as { v: string }).v)
    ) {
      const op = (take() as { v: string }).v;
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = power();
    while (
      peek()?.t === "op" &&
      ["*", "/"].includes((peek() as { v: string }).v)
    ) {
      const op = (take() as { v: string }).v;
      a = { k: "bin", op, a, b: power() };
    }
    return a;
  };
  const power = (): Node => {
    const a = unary();
    if (peek()?.t === "op" && (peek() as { v: string }).v === "^") {
      take();
      return { k: "bin", op: "^", a, b: power() };
    }
    return a;
  };
  const unary = (): Node => {
    if (peek()?.t === "op" && (peek() as { v: string }).v === "-") {
      take();
      return { k: "neg", a: unary() };
    }
    if (peek()?.t === "op" && (peek() as { v: string }).v === "+") {
      take();
      return unary();
    }
    return atom();
  };
  const atom = (): Node => {
    const t = take();
    if (!t) throw new Error("The formula ends too soon.");
    if (t.t === "num") return { k: "num", v: t.v, pct: t.pct };
    if (t.t === "(") {
      const e = expr();
      if (take()?.t !== ")") throw new Error("A ( has no closing ).");
      return e;
    }
    if (t.t === "id") {
      const low = t.v.toLowerCase();
      if (peek()?.t === "(" && (FUNCTIONS as readonly string[]).includes(low)) {
        take();
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          args.push(expr());
          while (peek()?.t === ",") {
            take();
            args.push(expr());
          }
        }
        if (take()?.t !== ")") throw new Error(`${low}( has no closing ).`);
        return { k: "call", fn: low, args };
      }
      if (peek()?.t === "(")
        throw new Error(
          `"${t.v}" is not a function. Try sum, avg, min, max, round, purity or pure.`,
        );
      return { k: "ref", name: t.v };
    }
    throw new Error("The formula is not complete.");
  };
  const n = expr();
  if (p < toks.length)
    throw new Error("There is something left over at the end of the formula.");
  return n;
}

/** The labels a formula refers to. */
export function referencesOf(src: string): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.k === "ref") out.push(n.name);
    else if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    } else if (n.k === "neg") walk(n.a);
    else if (n.k === "call") n.args.forEach(walk);
  };
  try {
    walk(parseFormula(src));
  } catch {
    /* an unfinished formula refers to nothing yet */
  }
  return out;
}

interface Val {
  v: Dec;
  unit?: string;
}

const same = (a?: string, b?: string) => (a ?? "") === (b ?? "");

function combineUnit(op: string, a: Val, b: Val): string | undefined {
  if (op === "+" || op === "-") {
    if (a.unit && b.unit && !same(a.unit, b.unit))
      throw new Error(`Cannot add ${a.unit} and ${b.unit}.`);
    return a.unit ?? b.unit;
  }
  if (op === "*" || op === "/") {
    if (op === "*" && (a.unit === "GHS" || b.unit === "GHS")) return "GHS"; // grams times a price is money
    if (a.unit && !b.unit) return a.unit;
    if (!a.unit && b.unit) return op === "*" ? b.unit : undefined;
    if (a.unit && b.unit && same(a.unit, b.unit) && op === "/")
      return undefined;
    return undefined;
  }
  return undefined;
}

/** Work out the whole sheet. Every note gets a result; errors are plain sentences a person can act on. */
export function evaluateSheet(
  doc: WorkingDoc,
  env: WorkingEnv = {},
): Map<string, NoteResult> {
  const parsed = new Map<string, ParsedNote>();
  const byLabel = new Map<string, string[]>();
  for (const n of doc.notes) {
    const p = parseNote(n.text);
    parsed.set(n.id, p);
    if (p.label && p.kind !== "text") {
      const key = p.label.toLowerCase();
      byLabel.set(key, [...(byLabel.get(key) ?? []), n.id]);
    }
  }
  const results = new Map<string, NoteResult>();
  const stack = new Set<string>();

  const resolve = (name: string, uses: string[]): Val => {
    const low = name.toLowerCase();
    const ids = byLabel.get(low);
    // "price" with no note of that name is the price of the day (a note called Price always wins)
    if (
      !ids?.length &&
      (low === "price" || low === "today's price" || low === "todays price")
    ) {
      if (!env.pricePerGram)
        throw new Error("There is no price of the day to use.");
      return { v: new D(env.pricePerGram), unit: "GHS" };
    }
    if (!ids?.length) throw new Error(`There is no note called "${name}".`);
    if (ids.length > 1)
      throw new Error(
        `Two notes are called "${name}". Give one of them another label.`,
      );
    const id = ids[0]!;
    uses.push(id);
    if (stack.has(id))
      throw new Error(
        `This goes round in a circle: "${name}" ends up using itself.`,
      );
    const r = compute(id);
    if (r.error) throw new Error(`"${name}" has a problem of its own.`);
    if (r.value === undefined) throw new Error(`"${name}" has no figure yet.`);
    if (r.unit === "%") return { v: new D(r.value).div(100) }; // "Fee 5%" counts as 0.05
    return { v: new D(r.value), unit: r.unit };
  };

  const evalNode = (n: Node, uses: string[]): Val => {
    switch (n.k) {
      case "num":
        return n.pct ? { v: new D(n.v).div(100) } : { v: new D(n.v) };
      case "ref":
        return resolve(n.name, uses);
      case "neg": {
        const a = evalNode(n.a, uses);
        return { v: a.v.neg(), unit: a.unit };
      }
      case "bin": {
        const a = evalNode(n.a, uses);
        const b = evalNode(n.b, uses);
        const unit = combineUnit(n.op, a, b);
        switch (n.op) {
          case "+":
            return { v: a.v.plus(b.v), unit };
          case "-":
            return { v: a.v.minus(b.v), unit };
          case "*":
            return { v: a.v.mul(b.v), unit };
          case "/":
            if (b.v.isZero()) throw new Error("Cannot divide by zero.");
            return { v: a.v.div(b.v), unit };
          case "^":
            return { v: a.v.pow(b.v), unit: undefined };
        }
        throw new Error("Unknown operation.");
      }
      case "call": {
        const args = n.args.map((a) => evalNode(a, uses));
        const need = (k: number) => {
          if (args.length < k)
            throw new Error(
              `${n.fn} needs ${k === 1 ? "a figure" : `${k} figures`}.`,
            );
        };
        const unitOfAll = () => {
          const u = args.find((a) => a.unit)?.unit;
          if (args.some((a) => a.unit && a.unit !== u))
            throw new Error(`${n.fn} mixes units.`);
          return u;
        };
        switch (n.fn) {
          case "sum":
            need(1);
            return {
              v: args.reduce((s, a) => s.plus(a.v), new D(0)),
              unit: unitOfAll(),
            };
          case "avg":
          case "average":
            need(1);
            return {
              v: args.reduce((s, a) => s.plus(a.v), new D(0)).div(args.length),
              unit: unitOfAll(),
            };
          case "min":
            need(1);
            return {
              v: args.reduce((m, a) => (a.v.lt(m) ? a.v : m), args[0]!.v),
              unit: unitOfAll(),
            };
          case "max":
            need(1);
            return {
              v: args.reduce((m, a) => (a.v.gt(m) ? a.v : m), args[0]!.v),
              unit: unitOfAll(),
            };
          case "abs":
            need(1);
            return { v: args[0]!.v.abs(), unit: args[0]!.unit };
          case "round": {
            need(1);
            const dp = args[1] ? args[1].v.toNumber() : 0;
            return {
              v: args[0]!.v.toDecimalPlaces(
                Math.max(0, Math.min(10, dp)),
                D.ROUND_HALF_UP,
              ),
              unit: args[0]!.unit,
            };
          }
          case "purity": {
            need(1);
            const k = args[0]!.v;
            if (k.lte(0) || k.gt(24))
              throw new Error("Karat must be between 0 and 24.");
            return { v: k.div(24) };
          }
          case "pure": {
            need(2);
            const w = args[0]!;
            const k = args[1]!.v;
            if (k.lte(0) || k.gt(24))
              throw new Error("Karat must be between 0 and 24.");
            return { v: w.v.mul(k).div(24), unit: w.unit ?? "g" };
          }
        }
        throw new Error(`"${n.fn}" is not a function.`);
      }
    }
  };

  const compute = (id: string): NoteResult => {
    const done = results.get(id);
    if (done) return done;
    const p = parsed.get(id)!;
    const uses: string[] = [];
    let r: NoteResult;
    if (p.kind === "figure") r = { value: p.value, unit: p.unit, uses };
    else if (p.kind === "text") r = { uses };
    else {
      stack.add(id);
      try {
        const v = evalNode(parseFormula(p.formula!), uses);
        r = { value: trimDec(v.v), unit: v.unit, uses };
      } catch (e) {
        r = {
          error:
            e instanceof Error
              ? e.message
              : "This formula could not be worked out.",
          uses,
        };
      }
      stack.delete(id);
    }
    results.set(id, r);
    return r;
  };

  for (const n of doc.notes) compute(n.id);
  return results;
}

/** Exact value as text, with no trailing zeros. */
function trimDec(d: Dec): string {
  const s = d.toFixed();
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** For showing: thousands separators and at most four places (the value underneath keeps everything). */
export function formatValue(value: string, unit?: string): string {
  const d = new D(value);
  const rounded = d.toDecimalPlaces(4, D.ROUND_HALF_UP);
  const [int, frac] = trimDec(rounded).split(".");
  const neg = int!.startsWith("-");
  const digits = neg ? int!.slice(1) : int!;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${neg ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
  if (!unit) return body;
  if (unit === "GHS") return `GHS ${body}`;
  if (unit === "%") return `${body}%`;
  return `${body} ${unit}`;
}

/** Sum, average, count, min and max of some notes, for the selection bar. Only notes with a figure count. */
export function aggregate(
  values: (NoteResult | undefined)[],
): {
  count: number;
  sum: string;
  avg: string;
  min: string;
  max: string;
  unit?: string;
  mixed: boolean;
} | null {
  const vs = values.filter(
    (r): r is NoteResult => !!r && r.value !== undefined && !r.error,
  );
  if (!vs.length) return null;
  const units = new Set(vs.map((v) => v.unit ?? ""));
  const ds = vs.map((v) => new D(v.value!));
  const sum = ds.reduce((s, d) => s.plus(d), new D(0));
  return {
    count: vs.length,
    sum: trimDec(sum),
    avg: trimDec(sum.div(ds.length)),
    min: trimDec(ds.reduce((m, d) => (d.lt(m) ? d : m), ds[0]!)),
    max: trimDec(ds.reduce((m, d) => (d.gt(m) ? d : m), ds[0]!)),
    unit: units.size === 1 ? vs[0]!.unit : undefined,
    mixed: units.size > 1,
  };
}

/** Write a label the way a formula can refer to it: plain words as they are, anything else in brackets. */
export function refToken(label: string): string {
  return /^[A-Za-z_][A-Za-z0-9_']*(?:\s+[A-Za-z_][A-Za-z0-9_']*)*$/.test(
    label,
  ) && !(FUNCTIONS as readonly string[]).includes(label.toLowerCase())
    ? label
    : `[${label}]`;
}

/** A label no other note on the sheet uses: "Result", "Result 2", ... */
export function freeLabel(doc: WorkingDoc, base = "Result"): string {
  const taken = new Set(
    doc.notes
      .map((n) => parseNote(n.text).label?.toLowerCase())
      .filter(Boolean),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++)
    if (!taken.has(`${base.toLowerCase()} ${i}`)) return `${base} ${i}`;
}

/** The notes a note depends on, directly or through others (to show "where did this come from"). */
export function upstreamOf(
  id: string,
  results: Map<string, NoteResult>,
): Set<string> {
  const out = new Set<string>();
  const walk = (x: string) => {
    for (const u of results.get(x)?.uses ?? [])
      if (!out.has(u)) {
        out.add(u);
        walk(u);
      }
  };
  walk(id);
  return out;
}
