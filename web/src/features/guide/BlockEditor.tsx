import { useRef, useState } from "react";
import { Input, Segmented } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoldIcon,
  ItalicIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/toast";
import {
  BLOCK_TYPES,
  NODE_KINDS,
  LIST_STYLES,
  TONES,
  toggleMark,
  type Block,
  type FlowNode,
} from "./blocks";
import { dataUrlKb, pictureToDataUrl } from "./image";

const LABELS: Record<string, string> = Object.fromEntries(
  BLOCK_TYPES.map((b) => [b.type, b.label]),
);

/** Text with a bold and italic button: they wrap the selected words in ** or *. */
function RichText({
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<TextAreaRef | null>(null);
  const mark = (m: "**" | "*") => {
    const el = ref.current?.resizableTextArea?.textArea;
    if (!el) return;
    const r = toggleMark(value, el.selectionStart, el.selectionEnd, m);
    if (r.text === value) return toast.info("Select some words first.");
    onChange(r.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };
  return (
    <div>
      <div className="mb-1 flex gap-1">
        <button
          type="button"
          onClick={() => mark("**")}
          className="grid size-9 place-items-center rounded-lg border border-border hover:bg-muted"
          aria-label="Bold"
          title="Bold (select words first)"
        >
          <BoldIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => mark("*")}
          className="grid size-9 place-items-center rounded-lg border border-border hover:bg-muted"
          aria-label="Italic"
          title="Italic (select words first)"
        >
          <ItalicIcon className="size-4" aria-hidden />
        </button>
      </div>
      <Input.TextArea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        maxLength={5000}
      />
    </div>
  );
}

function ListEditor({
  items,
  onChange,
}: {
  items: string[];
  onChange: (v: string[]) => void;
}) {
  const set = (i: number, v: string) =>
    onChange(items.map((x, k) => (k === i ? v : x)));
  return (
    <div className="space-y-2">
      {items.map((t, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={t}
            placeholder={`Item ${i + 1}`}
            maxLength={500}
            onChange={(e) => set(i, e.target.value)}
            onPressEnter={() =>
              onChange([...items.slice(0, i + 1), "", ...items.slice(i + 1)])
            }
            aria-label={`Item ${i + 1}`}
          />
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            onClick={() =>
              onChange(
                items.length > 1 ? items.filter((_, k) => k !== i) : [""],
              )
            }
            aria-label={`Remove item ${i + 1}`}
          >
            <Trash2Icon className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...items, ""])}>
        <PlusIcon className="mr-1.5 size-4" aria-hidden />
        Add an item
      </Button>
    </div>
  );
}

const NODE_LABEL = {
  step: "Step",
  decision: "Question (yes / no)",
  end: "Finish",
} as const;

function FlowEditor({
  nodes,
  onChange,
}: {
  nodes: FlowNode[];
  onChange: (v: FlowNode[]) => void;
}) {
  const patch = (i: number, p: Partial<FlowNode>) =>
    onChange(nodes.map((n, k) => (k === i ? { ...n, ...p } : n)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= nodes.length) return;
    const next = [...nodes];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Steps run from top to bottom. After a question the chart carries on from
        “Yes”; say in “No” where that answer ends.
      </p>
      {nodes.map((n, i) => (
        <div
          key={i}
          className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"
        >
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-navy text-xs font-semibold text-white">
              {i + 1}
            </span>
            <Segmented
              size="small"
              value={n.kind}
              options={NODE_KINDS.map((k) => ({
                value: k,
                label: NODE_LABEL[k],
              }))}
              onChange={(v) => patch(i, { kind: v as FlowNode["kind"] })}
              aria-label={`Kind of step ${i + 1}`}
            />
            <span className="ml-auto flex">
              <button
                type="button"
                className="grid size-8 place-items-center rounded hover:bg-muted"
                onClick={() => move(i, -1)}
                aria-label="Move up"
              >
                <ArrowUpIcon className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className="grid size-8 place-items-center rounded hover:bg-muted"
                onClick={() => move(i, 1)}
                aria-label="Move down"
              >
                <ArrowDownIcon className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className="grid size-8 place-items-center rounded hover:bg-muted"
                onClick={() =>
                  onChange(
                    nodes.length > 1 ? nodes.filter((_, k) => k !== i) : nodes,
                  )
                }
                aria-label="Remove"
              >
                <Trash2Icon className="size-4" aria-hidden />
              </button>
            </span>
          </div>
          <Input
            value={n.text}
            maxLength={200}
            placeholder={
              n.kind === "decision"
                ? "The question, e.g. Is this person the customer?"
                : n.kind === "end"
                  ? "How it ends, e.g. Done"
                  : "What to do"
            }
            onChange={(e) => patch(i, { text: e.target.value })}
            aria-label={`Text of step ${i + 1}`}
          />
          {n.kind === "decision" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={n.yes ?? ""}
                maxLength={160}
                placeholder="If yes…"
                onChange={(e) => patch(i, { yes: e.target.value })}
                aria-label="If yes"
              />
              <Input
                value={n.no ?? ""}
                maxLength={160}
                placeholder="If no…"
                onChange={(e) => patch(i, { no: e.target.value })}
                aria-label="If no"
              />
            </div>
          ) : null}
        </div>
      ))}
      <Button
        variant="secondary"
        onClick={() => onChange([...nodes, { kind: "step", text: "" }])}
      >
        <PlusIcon className="mr-1.5 size-4" aria-hidden />
        Add a step
      </Button>
    </div>
  );
}

function ImageEditor({
  block,
  onChange,
}: {
  block: Extract<Block, { type: "image" }>;
  onChange: (b: Block) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      onChange({ ...block, src: await pictureToDataUrl(file) });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "The picture could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {block.src ? (
        <div className="flex items-center gap-3">
          <img
            src={block.src}
            alt=""
            className="h-20 w-28 rounded-lg border border-border object-cover"
          />
          <div className="text-xs text-muted-foreground">
            {dataUrlKb(block.src)} KB
            <br />
            <button
              type="button"
              className="underline"
              onClick={() => input.current?.click()}
            >
              Choose another
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground hover:bg-muted"
        >
          <UploadIcon className="size-5" aria-hidden />
          {busy
            ? "Preparing…"
            : "Choose a picture (a photo, a screenshot or a drawing)"}
        </button>
      )}
      <Input
        value={block.caption ?? ""}
        maxLength={200}
        placeholder="Caption (optional)"
        onChange={(e) => onChange({ ...block, caption: e.target.value })}
        aria-label="Caption"
      />
    </div>
  );
}

function Body({
  block,
  onChange,
}: {
  block: Block;
  onChange: (b: Block) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <Input
          size="large"
          value={block.text}
          maxLength={200}
          placeholder="A heading"
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          aria-label="Heading"
        />
      );
    case "text":
      return (
        <RichText
          value={block.text}
          onChange={(text) => onChange({ ...block, text })}
          placeholder="Write here. Select words and press B or I for bold or italic."
        />
      );
    case "list":
      return (
        <div className="space-y-3">
          <Segmented
            value={block.style}
            onChange={(v) =>
              onChange({ ...block, style: v as typeof block.style })
            }
            aria-label="Kind of list"
            options={LIST_STYLES.map((s) => ({
              value: s,
              label: {
                bullets: "Bullets",
                numbers: "Steps",
                dos: "✓ Do",
                donts: "✗ Don’t",
              }[s],
            }))}
          />
          <ListEditor
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
          />
        </div>
      );
    case "callout":
      return (
        <div className="space-y-2">
          <Segmented
            value={block.tone}
            onChange={(v) =>
              onChange({ ...block, tone: v as typeof block.tone })
            }
            aria-label="Kind of callout"
            options={TONES.map((t) => ({
              value: t,
              label: {
                info: "Good to know",
                warning: "Careful",
                danger: "Never",
                success: "Always",
              }[t],
            }))}
          />
          <Input
            value={block.title ?? ""}
            maxLength={80}
            placeholder="Title (optional)"
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            aria-label="Callout title"
          />
          <RichText
            value={block.text}
            rows={3}
            onChange={(text) => onChange({ ...block, text })}
            placeholder="What people must know"
          />
        </div>
      );
    case "image":
      return <ImageEditor block={block} onChange={onChange} />;
    case "flow":
      return (
        <div className="space-y-2">
          <Input
            value={block.title ?? ""}
            maxLength={120}
            placeholder="Title of the flowchart (optional)"
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            aria-label="Flowchart title"
          />
          <FlowEditor
            nodes={block.nodes}
            onChange={(nodes) => onChange({ ...block, nodes })}
          />
        </div>
      );
    case "divider":
      return (
        <p className="text-sm text-muted-foreground">
          A line between two parts.
        </p>
      );
  }
}

/** One block with its controls (move, remove) and the editor for its kind. */
export function BlockCard({
  block,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  block: Block;
  index: number;
  count: number;
  onChange: (b: Block) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
          {LABELS[block.type]}
        </span>
        <span className="ml-auto flex">
          <button
            type="button"
            disabled={index === 0}
            className="grid size-9 place-items-center rounded-lg hover:bg-muted disabled:opacity-30"
            onClick={() => onMove(-1)}
            aria-label={`Move ${LABELS[block.type]} up`}
          >
            <ArrowUpIcon className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            className="grid size-9 place-items-center rounded-lg hover:bg-muted disabled:opacity-30"
            onClick={() => onMove(1)}
            aria-label={`Move ${LABELS[block.type]} down`}
          >
            <ArrowDownIcon className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-lg text-red-600 hover:bg-muted"
            onClick={onRemove}
            aria-label={`Remove ${LABELS[block.type]}`}
          >
            <Trash2Icon className="size-4" aria-hidden />
          </button>
        </span>
      </div>
      <Body block={block} onChange={onChange} />
    </div>
  );
}
