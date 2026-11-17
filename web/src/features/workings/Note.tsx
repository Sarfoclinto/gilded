import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
import {
  formatValue,
  parseNote,
  type NoteResult,
  type WorkingNote,
} from "@gold/core";

export const NOTE_W = 176;

/**
 * One note on the sheet. Shown as its label and figure (or result); tapped once to select, again (or double-clicked) to write; dragged to move.
 * While writing, Enter keeps the text and Escape throws the change away. The raw text is the whole truth of the note.
 */
export function Note({
  note,
  result,
  selected,
  upstream,
  editing,
  zoom,
  onTap,
  onEdit,
  onChange,
  onCommit,
  onCancel,
  onMove,
  registerInsert,
}: {
  note: WorkingNote;
  result?: NoteResult;
  selected: boolean;
  upstream: boolean;
  editing: boolean;
  zoom: number;
  onTap: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onEdit: () => void;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onMove: (dx: number, dy: number, phase: "start" | "move") => void;
  registerInsert: (fn: (token: string) => void) => void;
}) {
  const [text, setText] = useState(note.text);
  const area = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    moved: boolean;
    last: { x: number; y: number };
  } | null>(null);
  const p = parseNote(note.text);

  useEffect(() => {
    if (editing) {
      setText(note.text);
      onChange(note.text);
      setTimeout(() => {
        area.current?.focus();
        area.current?.setSelectionRange(
          area.current.value.length,
          area.current.value.length,
        );
      }, 0);
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing) return;
    registerInsert((token) => {
      const el = area.current;
      if (!el) return;
      const a = el.selectionStart ?? text.length;
      const b = el.selectionEnd ?? a;
      const before = text.slice(0, a);
      const after = text.slice(b);
      const pad = before && !/[\s(=+\-*/×÷^,]$/.test(before) ? " " : "";
      const next = `${before}${pad}${token}${after.startsWith(" ") || !after ? "" : " "}${after}`;
      setText(next);
      onChange(next);
      setTimeout(() => {
        el.focus();
        const c = (before + pad + token).length;
        el.setSelectionRange(c, c);
      }, 0);
    });
  }, [editing, text, onChange, registerInsert]);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (editing) return;
    e.stopPropagation();
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      last: { x: e.clientX, y: e.clientY },
    };
  };
  const moveP = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.moved = true;
      onMove(
        (e.clientX - d.last.x) / zoom,
        (e.clientY - d.last.y) / zoom,
        "start",
      );
    } else
      onMove(
        (e.clientX - d.last.x) / zoom,
        (e.clientY - d.last.y) / zoom,
        "move",
      );
    d.last = { x: e.clientX, y: e.clientY };
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.stopPropagation();
    if (d.moved) return;
    if (selected && !e.shiftKey && !e.ctrlKey && !e.metaKey) onEdit();
    else onTap(e);
  };

  const tone = result?.error
    ? "border-red-300"
    : p.kind === "formula"
      ? "border-gold/70"
      : "border-border";
  const ring = selected
    ? "ring-2 ring-gold ring-offset-1"
    : upstream
      ? "ring-2 ring-gold/40"
      : "";

  return (
    <div
      className={`absolute select-none rounded-xl border bg-white px-3 py-2 shadow-[0_1px_3px_rgba(13,27,46,0.12)] ${tone} ${ring} ${editing ? "z-20" : "z-10"} ${selected ? "cursor-move" : "cursor-pointer"}`}
      style={{ left: note.x, top: note.y, width: NOTE_W, touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={moveP}
      onPointerUp={up}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) onEdit();
      }}
      role="group"
      aria-label={p.label ?? (p.kind === "formula" ? "Result" : "Note")}
    >
      {editing ? (
        <textarea
          ref={area}
          value={text}
          rows={Math.min(4, Math.max(1, Math.ceil(text.length / 22)))}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(text);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={() =>
            setTimeout(() => {
              if (document.activeElement !== area.current)
                onCommit(area.current?.value ?? text);
            }, 120)
          }
          placeholder="Weight 12.4 g  or  = Weight × 2"
          spellCheck={false}
          className="block w-full resize-none bg-transparent font-mono text-sm leading-5 focus:outline-none"
        />
      ) : p.kind === "text" ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-5">
          {note.text || "…"}
        </p>
      ) : (
        <>
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {p.label ?? (p.kind === "formula" ? "Result" : "")}
          </p>
          {result?.error ? (
            <p className="text-xs leading-4 text-red-700">{result.error}</p>
          ) : result?.value !== undefined ? (
            <p className="tnum truncate font-display text-lg font-semibold leading-6 text-navy">
              {formatValue(result.value, result.unit)}
            </p>
          ) : null}
          {p.kind === "formula" ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              = {p.formula}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
