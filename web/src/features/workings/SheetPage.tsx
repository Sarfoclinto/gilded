import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Modal, Popover, Select } from "antd";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleHelpIcon,
  ClipboardCopyIcon,
  CloudOffIcon,
  CopyIcon,
  EqualIcon,
  EyeIcon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  PrinterIcon,
  SigmaIcon,
  Trash2Icon,
  Undo2Icon,
  UsersIcon,
} from "lucide-react";
import {
  aggregate,
  evaluateSheet,
  formatValue,
  freeLabel,
  parseNote,
  refToken,
  upstreamOf,
  type WorkingDoc,
  type WorkingNote,
} from "@gold/core";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useCurrentPrice } from "@/features/prices/api";
import { useColleagues } from "@/features/personal/api";
import { toast } from "@/shared/ui/toast";
import { useSheetShares, useShareSheet, useUnshareSheet } from "./api";
import { openSheetStore } from "./local";
import { useSheet, type SaveState } from "./useSheet";
import { Note, NOTE_W } from "./Note";

const CANVAS_W = 4000;
const CANVAS_H = 3000;
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

function Help() {
  return (
    <div className="max-w-xs space-y-2 text-xs">
      <p>
        <strong>A figure:</strong> <code>Weight 12.4 g</code>,{" "}
        <code>Price 1,210 GHS</code>, <code>Fee 5%</code>.
      </p>
      <p>
        <strong>A result:</strong> start with <code>=</code> and point at other
        notes by their names: <code>= Weight × Price</code>. Give it a name to
        use it again: <code>Total = Weight × Price</code>. While typing a
        result, tap another note to put its name in.
      </p>
      <p>
        <strong>Maths:</strong> + − × ÷ ^ ( ) and <code>sum</code>,{" "}
        <code>avg</code>, <code>min</code>, <code>max</code>,{" "}
        <code>round(x, 2)</code>, <code>abs</code>.
      </p>
      <p>
        <strong>Gold:</strong> <code>purity(18)</code> = 0.75,{" "}
        <code>pure(Weight, Karat)</code> = pure grams, <code>price</code> =
        today's price per gram.
      </p>
      <p>
        <strong>Tips:</strong> tap an empty spot to write; drag a note to move
        it; drag on empty space to select several; Delete removes; Ctrl+Z
        undoes. Results keep every decimal and show up to four.
      </p>
      <p className="text-muted-foreground">
        Workings are scratch: nothing here goes into the books. Copy a result
        into the form you need.
      </p>
    </div>
  );
}

function Status({ state, error }: { state: SaveState; error: string | null }) {
  const text =
    state === "saved"
      ? "Saved"
      : state === "saving"
        ? "Saving…"
        : state === "device"
          ? "Saved on this device"
          : state === "offline"
            ? "Saved on this device · offline"
            : "Could not save";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${state === "error" ? "text-red-700" : "text-muted-foreground"}`}
      title={error ?? undefined}
      role="status"
    >
      {state === "saved" ? (
        <CheckIcon className="size-3.5" aria-hidden />
      ) : state === "offline" ? (
        <CloudOffIcon className="size-3.5" aria-hidden />
      ) : null}
      {text}
    </span>
  );
}

/** Copy text to the clipboard, with a fallback for browsers that refuse (older Safari on http). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const t = Object.assign(document.createElement("textarea"), {
      value: text,
    });
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Share one of the person's own sheets with one colleague, and see or stop the shares it has. */
function ShareDialog({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const colleagues = useColleagues(open);
  const shares = useSheetShares(id, open);
  const share = useShareSheet();
  const unshare = useUnshareSheet();
  const [to, setTo] = useState<string>();
  const person = colleagues.data?.find((c) => c.id === to);
  return (
    <Modal
      open={open}
      title="Share this sheet"
      okText={person ? `Share with ${person.displayName}` : "Share"}
      okButtonProps={{ disabled: !to }}
      confirmLoading={share.isPending}
      onCancel={onClose}
      onOk={async () => {
        if (to && person) {
          await share.mutateAsync({ id, to, name: person.displayName });
          setTo(undefined);
          void shares.refetch();
        }
      }}
    >
      <Select
        showSearch
        className="w-full"
        size="large"
        placeholder="Choose a colleague"
        loading={colleagues.isLoading}
        value={to}
        onChange={setTo}
        optionFilterProp="label"
        options={(colleagues.data ?? []).map((c) => ({
          value: c.id,
          label: c.displayName,
        }))}
      />
      {shares.data?.length ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {shares.data.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span>{p.displayName}</span>
              <button
                type="button"
                disabled={unshare.isPending}
                onClick={() =>
                  void unshare
                    .mutateAsync({ id, to: p.id })
                    .then(() => shares.refetch())
                }
                className="text-xs font-medium text-red-700 hover:underline"
              >
                Stop sharing
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
        <li>
          They get a notification and can open the sheet to read it, always
          seeing your latest version. They cannot change it or share it on, but
          they can save a copy of their own.
        </li>
        <li>
          You can stop sharing any time; their access ends at once. A copy they
          already saved stays theirs.
        </li>
        <li>
          The company's activity log records that you shared a sheet with this
          person, not what is on it.
        </li>
      </ul>
    </Modal>
  );
}

/** The sheet page: the route's sheet, full screen. */
export default function SheetPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <SheetView
      id={id}
      fresh={params.get("new") === "1"}
      onBack={() => navigate(paths.workings.href)}
    />
  );
}

/**
 * One scratch sheet: notes placed anywhere on a big page, worked out as you type. `compact` fits it in the Tools panel beside another page.
 * A sheet a colleague shared is shown read only: it can be read, selected and copied from, and saved as a copy of one's own.
 */
export function SheetView({
  id,
  fresh,
  compact = false,
  onBack,
}: {
  id: string;
  fresh: boolean;
  compact?: boolean;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id ?? "");
  const branchId = useAuth((s) => s.activeBranchId);
  const price = useCurrentPrice(branchId);
  const { sheet, state, error, missing, readOnly, sharedBy, update } = useSheet(
    id,
    fresh,
  );
  const [sharing, setSharing] = useState(false);
  const doc = sheet?.doc ?? { notes: [] };
  const env = useMemo(
    () => ({ pricePerGram: price.data?.effectivePrice ?? null }),
    [price.data?.effectivePrice],
  );
  const results = useMemo(() => evaluateSheet(doc, env), [doc, env]);

  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [name, setName] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const undo = useRef<WorkingDoc[]>([]);
  const insertRef = useRef<((token: string) => void) | null>(null);
  const editingRef = useRef<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (sheet) setName(sheet.name);
  }, [sheet?.name, sheet]);
  useEffect(() => {
    if (sheet?.doc.view && scroller.current) {
      scroller.current.scrollLeft = sheet.doc.view.x;
      scroller.current.scrollTop = sheet.doc.view.y;
      setZoom(sheet.doc.view.zoom || 1);
    }
  }, [sheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDoc = useCallback(
    (fn: (d: WorkingDoc) => WorkingDoc, remember = true) => {
      update((s) => {
        if (remember) {
          undo.current.push(s.doc);
          if (undo.current.length > 60) undo.current.shift();
        }
        return { doc: fn(s.doc) };
      });
    },
    [update],
  );

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return {
      x: (e.clientX - r.left + el.scrollLeft) / zoom,
      y: (e.clientY - r.top + el.scrollTop) / zoom,
    };
  };

  const addNote = useCallback(
    (x: number, y: number, text = "") => {
      const n: WorkingNote = {
        id: crypto.randomUUID(),
        x: Math.max(8, Math.round(x)),
        y: Math.max(8, Math.round(y)),
        text,
      };
      setDoc((d) => ({ ...d, notes: [...d.notes, n] }));
      setSelected(new Set([n.id]));
      setEditing(n.id);
      return n.id;
    },
    [setDoc],
  );

  const commit = useCallback(
    (noteId: string, text: string) => {
      setEditing(null);
      editingRef.current = null;
      setSelected((cur) => {
        if (!cur.has(noteId)) return cur;
        const n = new Set(cur);
        n.delete(noteId);
        return n;
      });
      setDoc((d) => ({
        ...d,
        notes: text.trim()
          ? d.notes.map((n) => (n.id === noteId ? { ...n, text } : n))
          : d.notes.filter((n) => n.id !== noteId),
      }));
    },
    [setDoc],
  );

  const move = useCallback(
    (ids: Set<string>, dx: number, dy: number, phase: "start" | "move") => {
      setDoc(
        (d) => ({
          ...d,
          notes: d.notes.map((n) =>
            ids.has(n.id)
              ? {
                  ...n,
                  x: Math.max(0, Math.round(n.x + dx)),
                  y: Math.max(0, Math.round(n.y + dy)),
                }
              : n,
          ),
        }),
        phase === "start",
      );
    },
    [setDoc],
  );

  const removeSelected = useCallback(() => {
    if (!selected.size || readOnly) return;
    setDoc((d) => ({
      ...d,
      notes: d.notes.filter((n) => !selected.has(n.id)),
    }));
    setSelected(new Set());
  }, [selected, setDoc]);

  const duplicateSelected = useCallback(() => {
    const ids = new Set<string>();
    setDoc((d) => ({
      ...d,
      notes: [
        ...d.notes,
        ...d.notes
          .filter((n) => selected.has(n.id))
          .map((n) => {
            const c = {
              ...n,
              id: crypto.randomUUID(),
              x: n.x + 24,
              y: n.y + 24,
            };
            ids.add(c.id);
            return c;
          }),
      ],
    }));
    setSelected(ids);
  }, [selected, setDoc]);

  const totalOfSelected = useCallback(() => {
    const picked = doc.notes.filter(
      (n) => selected.has(n.id) && results.get(n.id)?.value !== undefined,
    );
    if (!picked.length) return;
    const refs = picked.map((n) => {
      const p = parseNote(n.text);
      return p.label ? refToken(p.label) : null;
    });
    if (refs.some((r) => !r)) {
      // give unnamed figures a name first, so the total can point at them
      let i = 1;
      setDoc((d) => ({
        ...d,
        notes: d.notes.map((n) => {
          if (!selected.has(n.id)) return n;
          const p = parseNote(n.text);
          if (p.label || p.kind !== "figure") return n;
          const label = freeLabel({ notes: d.notes }, `Item ${i++}`);
          return { ...n, text: `${label} ${n.text.trim()}` };
        }),
      }));
    }
    setTimeout(() => {
      update((s) => {
        const names = s.doc.notes
          .filter((n) => selected.has(n.id))
          .map((n) => parseNote(n.text).label)
          .filter((l): l is string => !!l)
          .map(refToken);
        const bottom = Math.max(...picked.map((n) => n.y)) + 96;
        const left = Math.min(...picked.map((n) => n.x));
        const n: WorkingNote = {
          id: crypto.randomUUID(),
          x: left,
          y: bottom,
          text: `${freeLabel(s.doc, "Total")} = sum(${names.join(", ")})`,
        };
        setSelected(new Set([n.id]));
        return { doc: { ...s.doc, notes: [...s.doc.notes, n] } };
      });
    }, 0);
  }, [doc.notes, selected, results, setDoc, update]);

  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (prev) update(() => ({ doc: prev }));
  }, [update]);

  // keys: Delete, Ctrl+Z, Escape, Ctrl+D
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        editing ||
        (e.target as HTMLElement)?.tagName === "INPUT" ||
        (e.target as HTMLElement)?.tagName === "TEXTAREA"
      )
        return;
      if (readOnly) {
        if (e.key === "Escape") setSelected(new Set());
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
        e.preventDefault();
        removeSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        doUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "d" &&
        selected.size
      ) {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setSelectMode(false);
      } else if (e.key === "Enter" && selected.size === 1) {
        e.preventDefault();
        setEditing([...selected][0]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selected, removeSelected, doUndo, duplicateSelected, readOnly]);

  // remember where the person was looking
  const saveView = useCallback(() => {
    const el = scroller.current;
    if (!el || !sheet) return;
    const view = {
      x: Math.round(el.scrollLeft),
      y: Math.round(el.scrollTop),
      zoom,
    };
    if (
      sheet.doc.view &&
      sheet.doc.view.x === view.x &&
      sheet.doc.view.y === view.y &&
      sheet.doc.view.zoom === view.zoom
    )
      return;
    update((s) => ({ doc: { ...s.doc, view } }));
  }, [sheet, zoom, update]);
  useEffect(() => {
    const t = setTimeout(saveView, 800);
    return () => clearTimeout(t);
  }, [zoom, saveView]);

  // empty space: a tap writes a new note; a drag selects what it covers
  const press = useRef<{
    x: number;
    y: number;
    cx: number;
    cy: number;
    moved: boolean;
  } | null>(null);
  const onCanvasDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (editing) {
      // tapping empty space while writing finishes the note
      const cur = editingRef.current;
      if (cur) commit(cur.id, cur.text);
      return;
    }
    const p = toCanvas(e);
    press.current = {
      x: p.x,
      y: p.y,
      cx: e.clientX,
      cy: e.clientY,
      moved: false,
    };
    if (e.pointerType !== "touch")
      e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onCanvasMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = press.current;
    if (!s || e.pointerType === "touch") return;
    if (!s.moved && Math.hypot(e.clientX - s.cx, e.clientY - s.cy) < 6) return;
    s.moved = true;
    const p = toCanvas(e);
    setMarquee({
      x0: Math.min(s.x, p.x),
      y0: Math.min(s.y, p.y),
      x1: Math.max(s.x, p.x),
      y1: Math.max(s.y, p.y),
    });
  };
  const onCanvasUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = press.current;
    press.current = null;
    if (!s) return;
    if (s.moved && marquee) {
      const inside = doc.notes
        .filter(
          (n) =>
            n.x < marquee.x1 &&
            n.x + NOTE_W > marquee.x0 &&
            n.y < marquee.y1 &&
            n.y + 40 > marquee.y0,
        )
        .map((n) => n.id);
      setSelected((cur) =>
        e.shiftKey ? new Set([...cur, ...inside]) : new Set(inside),
      );
      setMarquee(null);
      return;
    }
    setMarquee(null);
    if (selectMode || readOnly) {
      setSelected(new Set());
      return;
    }
    if (selected.size) {
      setSelected(new Set());
      return;
    }
    addNote(s.x, s.y);
  };

  const onNoteTap = (
    noteId: string,
    e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => {
    // writing a result and tapping another note puts that note's name into the formula
    if (
      editing &&
      editing !== noteId &&
      editingRef.current &&
      /=/.test(editingRef.current.text)
    ) {
      const label = parseNote(
        doc.notes.find((n) => n.id === noteId)?.text ?? "",
      ).label;
      if (label && insertRef.current) {
        insertRef.current(refToken(label));
        return;
      }
    }
    if (editing && editing !== noteId) {
      const cur = editingRef.current;
      if (cur) commit(cur.id, cur.text);
    }
    const toggle = selectMode || e.shiftKey || e.ctrlKey || e.metaKey;
    setSelected((cur) => {
      if (toggle) {
        const n = new Set(cur);
        if (n.has(noteId)) n.delete(noteId);
        else n.add(noteId);
        return n;
      }
      return new Set([noteId]);
    });
  };

  // two fingers zoom around the point between them; Ctrl + wheel (a laptop trackpad pinch) does the same
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const zoomAround = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const el = scroller.current;
      if (!el) return;
      setZoom((z) => {
        const nz = Math.min(2, Math.max(0.5, next));
        const r = el.getBoundingClientRect();
        const mx = clientX - r.left;
        const my = clientY - r.top;
        const cx = (el.scrollLeft + mx) / z;
        const cy = (el.scrollTop + my) / z;
        requestAnimationFrame(() => {
          el.scrollLeft = cx * nz - mx;
          el.scrollTop = cy * nz - my;
        });
        return Math.round(nz * 100) / 100;
      });
    },
    [],
  );
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const dist = (t: TouchList) =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch.current = { d: dist(e.touches), z: zoomRef.current };
        press.current = null;
        setMarquee(null);
      }
    };
    const move = (e: TouchEvent) => {
      const p0 = pinch.current;
      if (!p0 || e.touches.length !== 2) return;
      e.preventDefault();
      zoomAround(
        p0.z * (dist(e.touches) / p0.d),
        (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2,
        (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2,
      );
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomAround(zoomRef.current * (1 - e.deltaY * 0.01), e.clientX, e.clientY);
    };
    // not passive: these must stop the browser zooming the whole page instead of the sheet
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("wheel", wheel);
    };
  }, [zoomAround, missing]);

  const one = selected.size === 1 ? [...selected][0]! : null;
  const upstream = useMemo(
    () => (one ? upstreamOf(one, results) : new Set<string>()),
    [one, results],
  );
  const agg = useMemo(
    () =>
      selected.size > 1
        ? aggregate([...selected].map((i) => results.get(i)))
        : null,
    [selected, results],
  );
  const byId = useMemo(
    () => new Map(doc.notes.map((n) => [n.id, n])),
    [doc.notes],
  );
  const lines = useMemo(() => {
    if (!one) return [];
    const to = byId.get(one);
    if (!to) return [];
    return [...(results.get(one)?.uses ?? [])]
      .map((u) => byId.get(u))
      .filter((n): n is WorkingNote => !!n)
      .map((n) => ({ from: n, to }));
  }, [one, byId, results]);

  if (missing) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <p className="font-display text-xl font-semibold">
          This sheet is not here
        </p>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, the person who shared it may have stopped
          sharing, or it is not yet on this device and there is no connection.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          All sheets
        </button>
      </div>
    );
  }

  const zoomTo = (dir: 1 | -1) =>
    setZoom((z) =>
      dir > 0
        ? (ZOOMS.find((v) => v > z + 0.01) ?? ZOOMS[ZOOMS.length - 1]!)
        : ([...ZOOMS].reverse().find((v) => v < z - 0.01) ?? ZOOMS[0]!),
    );

  const oneResult = one ? results.get(one) : undefined;
  const copyOne = async () => {
    if (!oneResult?.value) return;
    const ok = await copyText(oneResult.value);
    if (ok)
      toast.success(`Copied ${oneResult.value}. Paste it where you need it.`);
    else
      toast.error(
        "This browser would not copy. Select the figure and copy it by hand.",
      );
  };
  const saveCopy = async () => {
    if (!sheet) return;
    const newId = crypto.randomUUID();
    const store = await openSheetStore();
    await store.put({
      id: newId,
      owner: me,
      name: `${sheet.name} (copy)`,
      doc: { notes: sheet.doc.notes },
      version: 0,
      dirty: true,
      updatedAt: Date.now(),
    });
    toast.success("Saved as your own sheet");
    navigate(paths.workings.sheet.to(newId));
  };

  return (
    <div
      className={
        compact
          ? "flex h-[calc(100dvh-17rem)] min-h-80 flex-col overflow-hidden rounded-xl border border-border lg:h-[calc(100dvh-12rem)]"
          : "-mb-20 flex h-[calc(100dvh-8.5rem)] flex-col lg:h-[calc(100dvh-3.5rem)]"
      }
      data-sheet
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 print:hidden">
        <button
          type="button"
          onClick={onBack}
          aria-label="All sheets"
          className="grid size-10 place-items-center rounded-lg hover:bg-muted"
        >
          <ArrowLeftIcon className="size-5" aria-hidden />
        </button>
        <input
          aria-label="Sheet name"
          readOnly={readOnly}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const v = name.trim() || "Untitled";
            setName(v);
            if (sheet && v !== sheet.name) update(() => ({ name: v }));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-display text-lg font-semibold hover:border-border focus:border-gold focus:outline-none sm:max-w-sm"
        />
        {readOnly ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-1 text-xs font-medium text-navy">
            <EyeIcon className="size-3.5" aria-hidden />
            Shared by {sharedBy} · read only
          </span>
        ) : (
          <Status state={state} error={error} />
        )}
        <span
          className={`hidden text-xs text-muted-foreground ${compact ? "" : "md:inline"}`}
        >
          {price.data
            ? `price = GHS ${Number(price.data.effectivePrice).toLocaleString("en-GH")}/g`
            : "no price of the day"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {readOnly ? (
            <button
              type="button"
              onClick={() => void saveCopy()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-semibold text-white"
            >
              <CopyIcon className="size-4" aria-hidden />
              Save a copy
            </button>
          ) : null}
          {!readOnly && !compact && sheet && sheet.version > 0 ? (
            <button
              type="button"
              onClick={() => setSharing(true)}
              title="Share with a colleague"
              className="grid size-10 place-items-center rounded-lg border border-border hover:bg-muted"
            >
              <UsersIcon className="size-4" aria-hidden />
            </button>
          ) : null}
          {readOnly ? null : (
            <>
              <button
                type="button"
                onClick={() => {
                  const el = scroller.current!;
                  addNote(
                    (el.scrollLeft + 80) / zoom,
                    (el.scrollTop + 80) / zoom,
                  );
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-semibold text-white"
              >
                <PlusIcon className="size-4" aria-hidden />
                <span className="hidden sm:inline">Note</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const el = scroller.current!;
                  addNote(
                    (el.scrollLeft + 80) / zoom,
                    (el.scrollTop + 140) / zoom,
                    "= ",
                  );
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
              >
                <EqualIcon className="size-4" aria-hidden />
                <span className="hidden sm:inline">Result</span>
              </button>
              <button
                type="button"
                aria-pressed={selectMode}
                onClick={() => setSelectMode((v) => !v)}
                title="Select several"
                className={`grid size-10 place-items-center rounded-lg border ${selectMode ? "border-gold bg-gold/15 text-navy" : "border-border hover:bg-muted"}`}
              >
                <MousePointer2Icon className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={doUndo}
                title="Undo (Ctrl+Z)"
                className="grid size-10 place-items-center rounded-lg border border-border hover:bg-muted"
              >
                <Undo2Icon className="size-4" aria-hidden />
              </button>
            </>
          )}
          <span
            className={`hidden items-center rounded-lg border border-border ${compact ? "" : "sm:inline-flex"}`}
          >
            <button
              type="button"
              onClick={() => zoomTo(-1)}
              aria-label="Zoom out"
              className="grid size-10 place-items-center hover:bg-muted"
            >
              <MinusIcon className="size-4" aria-hidden />
            </button>
            <span className="w-12 text-center text-xs tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomTo(1)}
              aria-label="Zoom in"
              className="grid size-10 place-items-center hover:bg-muted"
            >
              <PlusIcon className="size-4" aria-hidden />
            </button>
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            title="Print"
            className={`hidden size-10 place-items-center rounded-lg border border-border hover:bg-muted ${compact ? "" : "sm:grid"}`}
          >
            <PrinterIcon className="size-4" aria-hidden />
          </button>
          <Popover content={<Help />} trigger="click" placement="bottomRight">
            <button
              type="button"
              aria-label="How to write notes"
              className="grid size-10 place-items-center rounded-lg border border-border hover:bg-muted"
            >
              <CircleHelpIcon className="size-4" aria-hidden />
            </button>
          </Popover>
        </span>
      </div>

      <div
        ref={scroller}
        onScroll={() => {
          if (scroller.current) {
            clearTimeout(
              (
                scroller.current as HTMLDivElement & {
                  t?: ReturnType<typeof setTimeout>;
                }
              ).t,
            );
            (
              scroller.current as HTMLDivElement & {
                t?: ReturnType<typeof setTimeout>;
              }
            ).t = setTimeout(saveView, 800);
          }
        }}
        className="relative flex-1 overflow-auto overscroll-contain bg-[#f7f5ef] print:overflow-visible"
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div
          className="relative origin-top-left bg-[radial-gradient(circle,rgba(13,27,46,0.12)_1px,transparent_1px)] [background-size:24px_24px]"
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            transform: `scale(${zoom})`,
          }}
          onPointerDown={onCanvasDown}
          onPointerMove={onCanvasMove}
          onPointerUp={onCanvasUp}
          onPointerCancel={() => {
            press.current = null;
            setMarquee(null);
          }}
        >
          <h1 className="pointer-events-none absolute left-4 top-3 hidden font-display text-xl font-semibold print:block">
            {sheet?.name}
          </h1>
          <svg
            className="pointer-events-none absolute inset-0 size-full"
            aria-hidden
          >
            {lines.map(({ from, to }) => (
              <line
                key={from.id}
                x1={from.x + NOTE_W / 2}
                y1={from.y + 20}
                x2={to.x + NOTE_W / 2}
                y2={to.y + 20}
                stroke="#c9a84c"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            ))}
          </svg>
          {doc.notes.map((n) => (
            <Note
              key={n.id}
              note={n}
              result={results.get(n.id)}
              selected={selected.has(n.id)}
              upstream={upstream.has(n.id)}
              editing={editing === n.id}
              zoom={zoom}
              onTap={(e) => onNoteTap(n.id, e)}
              onEdit={() => {
                if (!selectMode && !readOnly) setEditing(n.id);
                else
                  onNoteTap(n.id, {
                    shiftKey: false,
                    ctrlKey: false,
                    metaKey: false,
                  });
              }}
              onChange={(text) => {
                editingRef.current = { id: n.id, text };
              }}
              onCommit={(text) => commit(n.id, text)}
              onCancel={() => {
                setEditing(null);
                editingRef.current = null;
                if (!n.text.trim())
                  setDoc(
                    (d) => ({
                      ...d,
                      notes: d.notes.filter((x) => x.id !== n.id),
                    }),
                    false,
                  );
              }}
              onMove={(dx, dy, phase) => {
                if (!readOnly)
                  move(
                    selected.has(n.id) ? selected : new Set([n.id]),
                    dx,
                    dy,
                    phase,
                  );
              }}
              registerInsert={(fn) => {
                insertRef.current = fn;
              }}
            />
          ))}
          {marquee ? (
            <div
              className="pointer-events-none absolute border border-gold bg-gold/10"
              style={{
                left: marquee.x0,
                top: marquee.y0,
                width: marquee.x1 - marquee.x0,
                height: marquee.y1 - marquee.y0,
              }}
            />
          ) : null}
          {!doc.notes.length && !editing ? (
            <p className="pointer-events-none absolute left-1/2 top-40 w-72 -translate-x-1/2 text-center text-sm text-muted-foreground print:hidden">
              Tap anywhere to write. <br />
              Try <code>Weight 12.4 g</code>, then <code>= Weight × price</code>
              .
            </p>
          ) : null}
        </div>
      </div>

      {selected.size > 0 && !editing ? (
        <div
          className={`flex flex-wrap items-center gap-2 border-t border-border bg-card py-2 pl-3 text-sm print:hidden ${compact ? "pr-3" : "pr-20"}`}
          role="toolbar"
          aria-label="Selected notes"
        >
          <span className="font-medium">{selected.size} selected</span>
          {agg ? (
            <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span>
                sum{" "}
                <strong className="tnum text-foreground">
                  {formatValue(agg.sum, agg.unit)}
                </strong>
              </span>
              <span>
                avg{" "}
                <strong className="tnum text-foreground">
                  {formatValue(agg.avg, agg.unit)}
                </strong>
              </span>
              <span>
                min{" "}
                <strong className="tnum text-foreground">
                  {formatValue(agg.min, agg.unit)}
                </strong>
              </span>
              <span>
                max{" "}
                <strong className="tnum text-foreground">
                  {formatValue(agg.max, agg.unit)}
                </strong>
              </span>
              {agg.mixed ? (
                <span className="text-amber-700">mixed units</span>
              ) : null}
            </span>
          ) : null}
          {oneResult?.value !== undefined && !oneResult.error ? (
            <span className="tnum text-xs text-muted-foreground">
              {formatValue(oneResult.value, oneResult.unit)}
            </span>
          ) : null}
          <span className="ml-auto flex gap-1.5">
            {oneResult?.value !== undefined && !oneResult.error ? (
              <button
                type="button"
                onClick={() => void copyOne()}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-navy px-2.5 text-xs font-semibold text-white"
              >
                <ClipboardCopyIcon className="size-3.5" aria-hidden />
                Copy
              </button>
            ) : null}
            {readOnly ? null : (
              <>
                {agg ? (
                  <button
                    type="button"
                    onClick={totalOfSelected}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"
                  >
                    <SigmaIcon className="size-3.5" aria-hidden />
                    Total note
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={duplicateSelected}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"
                >
                  <CopyIcon className="size-3.5" aria-hidden />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={removeSelected}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-red-600 px-2.5 text-xs font-semibold text-white"
                >
                  <Trash2Icon className="size-3.5" aria-hidden />
                  Delete
                </button>
              </>
            )}
          </span>
        </div>
      ) : null}
      {!readOnly ? (
        <ShareDialog id={id} open={sharing} onClose={() => setSharing(false)} />
      ) : null}
    </div>
  );
}
