import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { WifiOffIcon } from "lucide-react";
import { errorMessage } from "@/shared/api/errors";
import { useConnectivity } from "@/shared/offline/connectivity";
import { BrandMark, CoinEdge, Wordmark } from "@/shared/ui/BrandMark";
import { PasswordField } from "@/shared/ui/PasswordField";
import { TextField } from "@/shared/ui/TextField";
import { useLogin } from "../hooks";
import { useAuth } from "../store";

/**
 * Sign in. On a wide screen the navy panel carries the mark inside a coin's milled edge; on a phone that panel shrinks to a header and the
 * form rises over it, so the first thing on a small screen is still the form.
 */
export default function LoginPage() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const online = useConnectivity((s) => s.online);
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (status === "authenticated") return <Navigate to={from} replace />;

  const fields = login.error?.fieldErrors;
  const ready = username.trim() !== "" && password !== "" && !login.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    login.mutate({ username: username.trim(), password });
  };

  return (
    <main className="flex min-h-full flex-col bg-navy lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:bg-background">
      {/* Brand panel: a header on phones, a full side on desktop */}
      <section className="relative isolate overflow-hidden bg-navy text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_70%_40%,rgba(201,168,76,0.18),transparent_70%)]"
        />
        <CoinEdge className="pointer-events-none absolute -right-20 -top-20 -z-10 size-80 text-gold/40 sm:size-[26rem] lg:-right-32 lg:top-1/2 lg:size-[40rem] lg:-translate-y-1/2" />

        <div className="px-6 pb-20 pt-[max(1.75rem,env(safe-area-inset-top))] lg:p-0">
          <Wordmark markClass="h-9 lg:h-10" />
        </div>

        <div className="hidden max-w-lg lg:block">
          <BrandMark className="mb-8 h-28 drop-shadow-[0_8px_30px_rgba(201,168,76,0.35)] xl:h-32" />
          <h2 className="font-display text-4xl font-semibold leading-[1.15] [text-wrap:balance] xl:text-5xl">
            Every gram counted, every cedi accounted for.
          </h2>
          <p className="mt-4 max-w-md text-base text-white/65">
            Buy, value and track gold across your branches, even when the
            connection drops.
          </p>
        </div>

        <p className="hidden text-sm text-white/45 lg:block">
          Your sign-in is private to your company.
        </p>
      </section>

      {/* The form: rises over the header on a phone */}
      <section className="relative -mt-8 flex flex-1 flex-col rounded-t-[2rem] bg-background px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 sm:px-10 lg:mt-0 lg:items-center lg:justify-center lg:rounded-none lg:px-12 lg:py-12">
        <div className="mx-auto w-full max-w-sm lg:max-w-md">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl font-semibold text-navy">
                Welcome back
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in to open your branch.
              </p>
            </div>
            <span
              role="status"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${online ? "bg-emerald-500/10 text-emerald-800" : "bg-amber-500/15 text-amber-900"}`}
            >
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${online ? "bg-emerald-600" : "bg-amber-600"}`}
              />
              {online ? "Online" : "Offline"}
            </span>
          </div>

          {!online ? (
            <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/60 bg-amber-500/10 p-3 text-sm">
              <WifiOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                You can sign in offline if you have signed in on this device
                with a connection in the last 7 days.
              </span>
            </p>
          ) : null}

          <form
            onSubmit={submit}
            noValidate
            className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(13,27,46,0.06),0_12px_32px_-12px_rgba(13,27,46,0.18)] sm:p-6 [&_input]:min-h-12 [&_input]:rounded-xl [&_input:focus]:border-gold [&_input:focus]:ring-gold/30"
          >
            <TextField
              label="Username"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={fields?.username?.[0]}
            />
            <PasswordField
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fields?.password?.[0]}
            />
            {login.error && !fields ? (
              <p
                role="alert"
                className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700"
              >
                {errorMessage(login.error)}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={!ready}
              className="group relative inline-flex min-h-12 w-full items-center justify-center overflow-hidden rounded-xl bg-navy px-4 text-sm font-semibold text-white transition hover:bg-[#13294a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent"
              />
              {login.isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Forgot your password? Ask your manager to set a new one for you.
          </p>
          <p className="mt-8 text-center text-xs text-muted-foreground/80 lg:hidden">
            Your sign-in is private to your company.
          </p>
        </div>
      </section>
    </main>
  );
}
