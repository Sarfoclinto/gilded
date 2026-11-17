import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DeleteIcon, KeyRoundIcon, LockKeyholeIcon } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { useLogout } from "@/features/auth/hooks";
import { Avatar } from "@/features/photos/Avatar";
import { CoinEdge, Wordmark } from "@/shared/ui/BrandMark";
import { PasswordField } from "@/shared/ui/PasswordField";
import { checkPin, pinFor, pinProblem, setPin, PIN_MAX } from "./pin";
import { MAX_PIN_TRIES, useLock } from "./store";
import { verifyPassword } from "./verifyPassword";

type Mode = "pin" | "password" | "new-pin" | "confirm-pin";

/** The digits as dots: filled for typed, rings for the rest of the PIN's length. */
function Dots({
  count,
  length,
  shake,
}: {
  count: number;
  length: number;
  shake: boolean;
}) {
  return (
    <div
      className={`flex justify-center gap-3 ${shake ? "animate-[lock-shake_0.35s]" : ""}`}
      aria-hidden
    >
      {Array.from({ length }).map((_, i) => (
        <span
          key={i}
          className={`size-3.5 rounded-full border-2 transition-colors ${i < count ? "border-gold bg-gold" : "border-white/40"}`}
        />
      ))}
    </div>
  );
}

function Pad({
  onDigit,
  onBack,
  extra,
}: {
  onDigit: (d: string) => void;
  onBack: () => void;
  extra: React.ReactNode;
}) {
  const key =
    "grid h-16 place-items-center rounded-2xl text-2xl font-semibold text-white transition-colors hover:bg-white/10 active:bg-white/20 focus-visible:outline-2 focus-visible:outline-gold";
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="PIN pad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button
          key={d}
          type="button"
          className={key}
          onClick={() => onDigit(d)}
        >
          {d}
        </button>
      ))}
      <div className="grid place-items-center">{extra}</div>
      <button type="button" className={key} onClick={() => onDigit("0")}>
        0
      </button>
      <button
        type="button"
        className={key}
        onClick={onBack}
        aria-label="Delete the last digit"
      >
        <DeleteIcon className="size-6" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The lock screen. It covers the app without closing anything, so a half-filled purchase is still there after unlocking. Unlock with the
 * PIN set on this device, or the password. Five wrong PINs sign the person out. "Not you?" signs out so someone else can sign in.
 */
export function LockScreen() {
  const user = useAuth((s) => s.user);
  const lock = useLock((s) => s.lock);
  const logout = useLogout();
  const rec = user ? pinFor(user.id) : undefined;
  const [mode, setMode] = useState<Mode>(rec ? "pin" : "password");
  const [pin, setPinValue] = useState("");
  const [first, setFirst] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const length =
    mode === "pin"
      ? (rec?.length ?? 4)
      : Math.max(
          4,
          Math.min(PIN_MAX, pin.length + (pin.length < PIN_MAX ? 1 : 0)),
        );

  // nothing behind the lock can be reached with the keyboard or a screen reader
  useEffect(() => {
    const others = [...document.body.children].filter(
      (el) =>
        el !== boxRef.current?.parentElement && !el.contains(boxRef.current),
    );
    others.forEach((el) => el.setAttribute("inert", ""));
    return () => others.forEach((el) => el.removeAttribute("inert"));
  }, []);

  const wrong = useCallback((text: string) => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setPinValue("");
    setMsg(text);
  }, []);

  const tryPin = useCallback(
    async (value: string) => {
      if (!user) return;
      setBusy(true);
      const ok = await checkPin(user.id, value);
      setBusy(false);
      if (ok) {
        useLock.getState().unlock();
        return;
      }
      const left = useLock.getState().wrongPin();
      if (left <= 0) {
        setMsg("Too many wrong PINs. Signing you out.");
        setTimeout(() => logout.mutate(), 900);
        return;
      }
      wrong(`Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.`);
    },
    [user, logout, wrong],
  );

  // the PIN is checked here, never inside a state update (React may run those twice, which would count one wrong PIN as two)
  const pinRef = useRef("");
  pinRef.current = pin;
  const digit = useCallback(
    (d: string) => {
      if (busy) return;
      setMsg(null);
      const cur = pinRef.current;
      if (cur.length >= PIN_MAX) return;
      const next = cur + d;
      pinRef.current = next;
      setPinValue(next);
      if (mode === "pin" && rec && next.length === rec.length)
        void tryPin(next);
    },
    [busy, mode, rec, tryPin],
  );

  const submitNew = useCallback(async () => {
    if (!user) return;
    if (mode === "new-pin") {
      const p = pinProblem(pin);
      if (p) {
        wrong(p);
        return;
      }
      setFirst(pin);
      setPinValue("");
      setMode("confirm-pin");
      setMsg(null);
      return;
    }
    if (pin !== first) {
      setFirst("");
      setMode("new-pin");
      wrong("The two PINs were different. Start again.");
      return;
    }
    setBusy(true);
    await setPin(user.id, pin);
    setBusy(false);
    useLock.getState().unlock();
  }, [user, mode, pin, first, wrong]);

  // typing on a keyboard works too
  useEffect(() => {
    if (mode === "password") return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        digit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPinValue((c) => c.slice(0, -1));
      } else if (
        e.key === "Enter" &&
        (mode === "new-pin" || mode === "confirm-pin")
      ) {
        e.preventDefault();
        void submitNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, digit, submitNew]);

  const unlockWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await verifyPassword(password);
    setBusy(false);
    setPassword("");
    if (r === "ok") {
      if (!rec && user) {
        setMode("new-pin");
        setMsg(null);
        return;
      } // offer a PIN for next time
      useLock.getState().unlock();
      return;
    }
    setMsg(
      r === "cannot-check"
        ? "Your password cannot be checked on this device with no connection. Connect, or sign out and sign in again."
        : "That password is not right.",
    );
  };

  if (!user || !lock) return null;
  const tries = lock.tries;

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-modal="true"
      aria-label="Screen locked"
      className="fixed inset-0 z-[2000] flex flex-col overflow-y-auto bg-navy text-white"
    >
      <CoinEdge className="pointer-events-none absolute -right-24 -top-24 size-96 text-gold/20" />
      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
        <Wordmark markClass="h-8" className="opacity-90" />
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="rounded-full p-1 ring-2 ring-gold/70">
            <Avatar
              userId={user.id}
              name={user.displayName}
              className="size-20 text-xl"
            />
          </span>
          <div>
            <p className="font-display text-2xl font-semibold">
              {user.displayName}
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-white/70">
              <LockKeyholeIcon className="size-4" aria-hidden />
              {mode === "new-pin"
                ? "Choose a PIN for this device"
                : mode === "confirm-pin"
                  ? "Type the same PIN again"
                  : lock.reason === "idle"
                    ? "Locked after a while with no activity"
                    : "Locked"}
            </p>
          </div>
        </div>

        {mode === "password" ? (
          <form onSubmit={unlockWithPassword} className="w-full space-y-3">
            <div className="[&_input]:bg-white [&_input]:text-navy [&_label]:text-white/80">
              <PasswordField
                label="Password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={busy || !password}
              className="min-h-12 w-full rounded-xl bg-gold font-semibold text-navy disabled:opacity-60"
            >
              {busy ? "Checking…" : "Unlock"}
            </button>
            {rec ? (
              <button
                type="button"
                onClick={() => {
                  setMode("pin");
                  setMsg(null);
                }}
                className="w-full text-sm text-white/70 underline-offset-2 hover:underline"
              >
                Use my PIN
              </button>
            ) : null}
          </form>
        ) : (
          <div className="w-full space-y-5">
            <Dots count={pin.length} length={length} shake={shake} />
            <Pad
              onDigit={digit}
              onBack={() => setPinValue((c) => c.slice(0, -1))}
              extra={
                mode === "pin" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("password");
                      setMsg(null);
                      setPinValue("");
                    }}
                    className="grid size-14 place-items-center rounded-2xl text-white/70 hover:bg-white/10"
                    aria-label="Use my password instead"
                    title="Use my password instead"
                  >
                    <KeyRoundIcon className="size-6" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pin.length < 4 || busy}
                    onClick={() => void submitNew()}
                    className="h-12 rounded-xl bg-gold px-3 text-sm font-semibold text-navy disabled:opacity-40"
                  >
                    {mode === "new-pin" ? "Next" : "Save"}
                  </button>
                )
              }
            />
            {mode === "new-pin" || mode === "confirm-pin" ? (
              <button
                type="button"
                onClick={() => useLock.getState().unlock()}
                className="w-full text-sm text-white/70 underline-offset-2 hover:underline"
              >
                Not now
              </button>
            ) : null}
          </div>
        )}

        <p
          role="alert"
          className={`min-h-5 text-center text-sm ${msg ? "text-amber-200" : ""}`}
        >
          {msg ??
            (mode === "pin" && tries > 0
              ? `${MAX_PIN_TRIES - tries} tries left`
              : "")}
        </p>

        <button
          type="button"
          onClick={() => logout.mutate()}
          className="text-sm text-white/60 underline-offset-2 hover:text-white hover:underline"
        >
          Not {user.displayName.split(" ")[0]}? Sign out
        </button>
      </div>
    </div>,
    document.body,
  );
}
