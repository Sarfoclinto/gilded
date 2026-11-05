import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { useAuth } from "@/features/auth/store";
import {
  createOutbox,
  type FlushResult,
  type Handler,
  type Outbox,
} from "./outbox";
import { createBestStore, type OutboxEntry } from "./outboxStore";
import { useConnectivity } from "./connectivity";
import { signForUser } from "./deviceKey";

interface OutboxContextValue {
  outbox: Outbox | null;
}
const Ctx = createContext<OutboxContextValue>({ outbox: null });

interface Props extends PropsWithChildren {
  handlers: Record<string, Handler>;
  onSynced?: (entry: OutboxEntry, result: unknown) => void;
}

// One queue per page load, even under React StrictMode's double mount.
let instance: Promise<Outbox> | null = null;

/**
 * Owns the queue and decides WHEN to send: at start, when the connection returns, when the app comes
 * back to the foreground, and on a timer while anything is waiting. (iOS Safari has no background sync,
 * so these foreground triggers are what we have.)
 */
export function OutboxProvider({ handlers, onSynced, children }: Props) {
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const status = useAuth((s) => s.status);
  const setOnline = useConnectivity((s) => s.setOnline);
  const online = useConnectivity((s) => s.online);

  useEffect(() => {
    instance ??= (async () => {
      const box = createOutbox({
        store: await createBestStore(),
        handlers,
        onSynced,
        sign: signForUser,
        currentUser: () => useAuth.getState().user?.id ?? null,
      });
      await box.init();
      return box;
    })();
    let alive = true;
    void instance.then((b) => alive && setOutbox(b));
    return () => {
      alive = false;
    };
    // handlers/onSynced are module-level constants in the app; the queue is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!outbox || status !== "authenticated") return;
    const run = async (force = false) => {
      if (
        outbox
          .getSnapshot()
          .every(
            (e) =>
              e.status === "failed" ||
              (!!e.userId && e.userId !== useAuth.getState().user?.id),
          )
      )
        return;
      const r: FlushResult = await outbox.flush({ force });
      if (r.sent > 0) setOnline(true);
      else if (r.offline) setOnline(false);
    };
    void run(true);
    const onOnline = () => void run(true);
    const onVisible = () =>
      document.visibilityState === "visible" && void run();
    const timer = setInterval(() => void run(), 15_000);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [outbox, status, setOnline]);

  // The connection came back (browser event or our own detection): send what is waiting right away.
  useEffect(() => {
    if (
      online &&
      outbox &&
      status === "authenticated" &&
      outbox.getSnapshot().some((e) => e.status !== "failed")
    ) {
      void outbox.flush({ force: true });
    }
  }, [online, outbox, status]);

  const value = useMemo(() => ({ outbox }), [outbox]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const EMPTY: readonly OutboxEntry[] = [];

export function useOutbox() {
  const me = useAuth((s) => s.user?.id);
  const { outbox } = useContext(Ctx);
  const entries = useSyncExternalStore(
    (l) => (outbox ? outbox.subscribe(l) : () => {}),
    () => (outbox ? outbox.getSnapshot() : EMPTY),
  );
  return {
    ready: !!outbox,
    durable: outbox?.durable ?? true,
    entries,
    waiting: entries.filter(
      (e) => e.status !== "failed" && (!e.userId || e.userId === me),
    ),
    /** Saved on this device by someone else; they go out when that person signs in. */
    othersWaiting: entries.filter(
      (e) => e.status !== "failed" && !!e.userId && e.userId !== me,
    ),
    failed: entries.filter((e) => e.status === "failed"),
    enqueue: <P,>(id: string, type: string, payload: P) =>
      outbox!.enqueue(id, type, payload),
    syncNow: () => outbox?.flush({ force: true }),
    retry: (id: string) => outbox?.retry(id),
    discard: (id: string) => outbox?.discard(id),
  };
}
