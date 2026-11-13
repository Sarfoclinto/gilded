import { useEffect } from "react";
import { SearchIcon } from "lucide-react";
import { useSearchUi } from "./store";

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform ?? "");

/** Is the person typing somewhere? Then "/" is a character, not a shortcut. */
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
};

/** Ctrl+K (Cmd+K on a Mac) from anywhere, and "/" when not typing, open the search. Mounted once. */
export function SearchHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        useSearchUi.getState().toggle();
      } else if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !typing(e.target) &&
        !useSearchUi.getState().open
      ) {
        e.preventDefault();
        useSearchUi.getState().setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

/**
 * The way in. On a wide screen it looks like the box you will type in, with its shortcut; on a narrow one it is a round button.
 * It is a button, not a text box: the typing happens in the search itself, which opens over the page.
 */
export function SearchButton({ wide }: { wide: boolean }) {
  const open = () => useSearchUi.getState().setOpen(true);
  if (!wide) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Search"
        className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground hover:bg-muted"
      >
        <SearchIcon className="size-[18px]" aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search"
      className="group flex h-10 w-40 shrink items-center gap-2 rounded-full border border-border bg-background pl-3 pr-2 text-left text-sm text-muted-foreground transition-colors hover:border-gold hover:text-foreground xl:w-64"
    >
      <SearchIcon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search…</span>
      <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium xl:inline">
        {isMac() ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
