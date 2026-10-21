import { create } from 'zustand';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, text: string, ms?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, text, ms = kind === 'error' ? 6000 : 3000) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Use outside React (query callbacks) as well as inside. */
export const toast = {
  success: (text: string) => useToasts.getState().push('success', text),
  error: (text: string) => useToasts.getState().push('error', text),
  info: (text: string) => useToasts.getState().push('info', text),
};

const tone: Record<ToastKind, string> = {
  success: 'border-emerald-500/60',
  error: 'border-red-500/70',
  info: 'border-sky-500/60',
};

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto w-full max-w-md rounded-lg border-l-4 bg-surface px-4 py-3 text-left text-sm shadow-lg ${tone[t.kind]}`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
