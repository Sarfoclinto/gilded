import { Fragment } from "react";
import { Image } from "antd";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  CheckCircle2Icon,
  CheckIcon,
  InfoIcon,
  OctagonAlertIcon,
  XIcon,
} from "lucide-react";
import { parseInline, type Block, type FlowNode } from "./blocks";

/** Text with **bold** and *italic*, drawn as plain React text (never as HTML). Line breaks are kept. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <Fragment key={li}>
          {li > 0 ? <br /> : null}
          {parseInline(line).map((s, i) =>
            s.bold ? (
              <strong key={i}>{s.text}</strong>
            ) : s.italic ? (
              <em key={i}>{s.text}</em>
            ) : (
              <Fragment key={i}>{s.text}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

const TONE = {
  info: {
    box: "border-sky-500/40 bg-sky-500/10",
    icon: (
      <InfoIcon className="size-5 text-sky-600 dark:text-sky-400" aria-hidden />
    ),
    name: "Good to know",
  },
  warning: {
    box: "border-amber-500/50 bg-amber-500/10",
    icon: (
      <AlertTriangleIcon
        className="size-5 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
    ),
    name: "Be careful",
  },
  danger: {
    box: "border-red-500/50 bg-red-500/10",
    icon: (
      <OctagonAlertIcon
        className="size-5 text-red-600 dark:text-red-400"
        aria-hidden
      />
    ),
    name: "Never do this",
  },
  success: {
    box: "border-emerald-500/50 bg-emerald-500/10",
    icon: (
      <CheckCircle2Icon
        className="size-5 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    ),
    name: "Always do this",
  },
} as const;

function Flow({ title, nodes }: { title?: string; nodes: FlowNode[] }) {
  return (
    <figure
      className="rounded-xl border border-border bg-card p-4"
      aria-label={title || "Flowchart"}
    >
      {title ? (
        <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
      ) : null}
      <ol className="flex flex-col items-center">
        {nodes.map((n, i) => (
          <li key={i} className="flex w-full flex-col items-center">
            {i > 0 ? (
              <ArrowDownIcon
                className="my-1 size-5 text-muted-foreground"
                aria-hidden
              />
            ) : null}
            {n.kind === "decision" ? (
              <div className="w-full max-w-md rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-3 text-center">
                <p className="text-sm font-semibold">
                  <Inline text={n.text} />
                </p>
                {n.yes || n.no ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-left text-xs">
                    <div className="rounded-lg bg-emerald-500/15 p-2">
                      <span className="font-bold text-emerald-700 dark:text-emerald-300">
                        Yes
                      </span>
                      <br />
                      {n.yes}
                    </div>
                    <div className="rounded-lg bg-red-500/15 p-2">
                      <span className="font-bold text-red-700 dark:text-red-300">
                        No
                      </span>
                      <br />
                      {n.no}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : n.kind === "end" ? (
              <div className="rounded-full bg-navy px-5 py-2 text-center text-sm font-semibold text-white">
                <Inline text={n.text} />
              </div>
            ) : (
              <div className="w-full max-w-md rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-center text-sm">
                <Inline text={n.text} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** One block as a reader sees it. The editor's preview uses this same component, so what the writer sees is what everyone gets. */
export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading":
      return (
        <h2 className="pt-2 text-xl font-bold tracking-tight">{block.text}</h2>
      );
    case "text":
      return (
        <p className="text-[15px] leading-relaxed">
          <Inline text={block.text} />
        </p>
      );
    case "list": {
      if (block.style === "dos" || block.style === "donts") {
        const good = block.style === "dos";
        return (
          <div
            className={`rounded-xl border p-4 ${good ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}
          >
            <p
              className={`mb-2 text-sm font-bold uppercase tracking-wide ${good ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
            >
              {good ? "Do" : "Don’t"}
            </p>
            <ul className="space-y-2">
              {block.items.map((t, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white ${good ? "bg-emerald-600" : "bg-red-600"}`}
                  >
                    {good ? (
                      <CheckIcon className="size-3.5" aria-hidden />
                    ) : (
                      <XIcon className="size-3.5" aria-hidden />
                    )}
                  </span>
                  <span>
                    <Inline text={t} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      }
      const Tag = block.style === "numbers" ? "ol" : "ul";
      return (
        <Tag
          className={`space-y-1.5 pl-6 text-[15px] leading-relaxed ${block.style === "numbers" ? "list-decimal" : "list-disc"}`}
        >
          {block.items.map((t, i) => (
            <li key={i}>
              <Inline text={t} />
            </li>
          ))}
        </Tag>
      );
    }
    case "callout": {
      const t = TONE[block.tone];
      return (
        <div
          role="note"
          className={`flex gap-3 rounded-xl border p-4 ${t.box}`}
        >
          <span className="mt-0.5 shrink-0">{t.icon}</span>
          <div className="min-w-0 text-[15px] leading-relaxed">
            <p className="font-semibold">{block.title?.trim() || t.name}</p>
            {block.text ? (
              <p className="mt-0.5">
                <Inline text={block.text} />
              </p>
            ) : null}
          </div>
        </div>
      );
    }
    case "image":
      return block.src ? (
        <figure className="space-y-1.5">
          <Image
            src={block.src}
            alt={block.caption || ""}
            className="rounded-xl border border-border"
            style={{ maxWidth: "100%", height: "auto" }}
          />
          {block.caption ? (
            <figcaption className="text-center text-xs text-muted-foreground">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      ) : null;
    case "flow":
      return <Flow title={block.title} nodes={block.nodes} />;
    case "divider":
      return <hr className="border-border" />;
  }
}

export function BlocksView({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}
