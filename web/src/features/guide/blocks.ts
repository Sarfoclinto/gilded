import { z } from "zod";

/**
 * What a Guide article is made of. Plain data, never HTML: the reader draws each block itself, so nothing typed or pasted by a writer
 * can run as code. Keep in step with gold.guide_check_blocks in migration 0046.
 */
export const LIST_STYLES = ["bullets", "numbers", "dos", "donts"] as const;
export const TONES = ["info", "warning", "danger", "success"] as const;
export const NODE_KINDS = ["step", "decision", "end"] as const;

export const flowNodeSchema = z.object({
  kind: z.enum(NODE_KINDS),
  text: z.string().default(""),
  /** Decisions: what happens for each answer. */
  yes: z.string().optional(),
  no: z.string().optional(),
});

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().default("") }),
  z.object({ type: z.literal("text"), text: z.string().default("") }),
  z.object({
    type: z.literal("list"),
    style: z.enum(LIST_STYLES).default("bullets"),
    items: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(TONES).default("info"),
    title: z.string().optional(),
    text: z.string().default(""),
  }),
  z.object({
    type: z.literal("image"),
    src: z.string(),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("flow"),
    title: z.string().optional(),
    nodes: z.array(flowNodeSchema).default([]),
  }),
  z.object({ type: z.literal("divider") }),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export type FlowNode = z.infer<typeof flowNodeSchema>;

/** A block the reader does not know (written by a newer version) is skipped instead of breaking the page. */
export const blocksSchema = z.array(z.unknown()).transform((list) =>
  list.flatMap((b) => {
    const r = blockSchema.safeParse(b);
    return r.success ? [r.data] : [];
  }),
);

export const BLOCK_TYPES: { type: BlockType; label: string; hint: string }[] = [
  { type: "heading", label: "Heading", hint: "A title for the next part" },
  { type: "text", label: "Text", hint: "A paragraph, with bold and italic" },
  { type: "list", label: "List", hint: "Bullets, steps, or do and don’t" },
  { type: "callout", label: "Callout", hint: "A box that cannot be missed" },
  { type: "image", label: "Picture", hint: "A photo, screenshot or drawing" },
  { type: "flow", label: "Flowchart", hint: "Steps and yes/no decisions" },
  { type: "divider", label: "Line", hint: "A line between parts" },
];

export function newBlock(type: BlockType): Block {
  switch (type) {
    case "heading":
      return { type, text: "" };
    case "text":
      return { type, text: "" };
    case "list":
      return { type, style: "bullets", items: [""] };
    case "callout":
      return { type, tone: "info", text: "" };
    case "image":
      return { type, src: "" };
    case "flow":
      return { type, nodes: [{ kind: "step", text: "" }] };
    case "divider":
      return { type };
  }
}

/** Whether a block has anything to show (empty ones are left out of the preview and of what readers see). */
export function isBlank(b: Block): boolean {
  switch (b.type) {
    case "heading":
    case "text":
      return b.text.trim() === "";
    case "list":
      return b.items.every((i) => i.trim() === "");
    case "callout":
      return b.text.trim() === "" && !(b.title ?? "").trim();
    case "image":
      return b.src === "";
    case "flow":
      return b.nodes.every((n) => n.text.trim() === "");
    case "divider":
      return false;
  }
}

/** Blocks as they are saved: blank ones dropped, text trimmed. */
export function cleanBlocks(blocks: Block[]): Block[] {
  return blocks
    .filter((b) => !isBlank(b))
    .map((b): Block => {
      switch (b.type) {
        case "heading":
        case "text":
          return { ...b, text: b.text.trim() };
        case "list":
          return { ...b, items: b.items.map((i) => i.trim()).filter(Boolean) };
        case "callout":
          return {
            ...b,
            text: b.text.trim(),
            ...(b.title?.trim()
              ? { title: b.title.trim() }
              : { title: undefined }),
          };
        case "flow":
          return {
            ...b,
            nodes: b.nodes
              .filter((n) => n.text.trim())
              .map((n) => ({ ...n, text: n.text.trim() })),
          };
        default:
          return b;
      }
    });
}

export interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
}

/**
 * The little formatting writers can use inside text: **bold** and *italic*. Anything else stays as typed.
 * Unclosed marks are shown as typed, so a stray * never swallows the rest of a sentence.
 */
export function parseInline(input: string): Span[] {
  const out: Span[] = [];
  const re = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  for (let m = re.exec(input); m; m = re.exec(input)) {
    if (m.index > last)
      out.push({
        text: input.slice(last, m.index),
        bold: false,
        italic: false,
      });
    out.push({
      text: (m[1] ?? m[2])!,
      bold: m[1] !== undefined,
      italic: m[2] !== undefined,
    });
    last = m.index + m[0].length;
  }
  if (last < input.length)
    out.push({ text: input.slice(last), bold: false, italic: false });
  return out;
}

/** Wraps the selected part of a text in a mark ("**" or "*"), or removes it when it is already wrapped. */
export function toggleMark(
  text: string,
  start: number,
  end: number,
  mark: "**" | "*",
): { text: string; start: number; end: number } {
  const before = text.slice(0, start);
  const sel = text.slice(start, end);
  const after = text.slice(end);
  const l = mark.length;
  if (sel.length === 0) return { text, start, end };
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return {
      text: before.slice(0, -l) + sel + after.slice(l),
      start: start - l,
      end: end - l,
    };
  }
  return {
    text: before + mark + sel + mark + after,
    start: start + l,
    end: end + l,
  };
}

export const KINDS = [
  { value: "rule", label: "Rule" },
  { value: "dos_donts", label: "Dos and don’ts" },
  { value: "howto", label: "How to" },
  { value: "info", label: "Good to know" },
] as const;
export type Kind = (typeof KINDS)[number]["value"];
export const kindLabel = (k: string) =>
  KINDS.find((x) => x.value === k)?.label ?? "Guide";

/** How many minutes it takes to read, roughly (for "3 min read"). Pictures and flowcharts count a little. */
export function readMinutes(blocks: Block[]): number {
  let words = 0;
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "text")
      words += b.text.split(/\s+/).filter(Boolean).length;
    else if (b.type === "list")
      words += b.items.join(" ").split(/\s+/).filter(Boolean).length + 4;
    else if (b.type === "callout")
      words += `${b.title ?? ""} ${b.text}`.split(/\s+/).filter(Boolean).length;
    else if (b.type === "flow") words += b.nodes.length * 12;
    else if (b.type === "image") words += 30;
  }
  return Math.max(1, Math.round(words / 200));
}
