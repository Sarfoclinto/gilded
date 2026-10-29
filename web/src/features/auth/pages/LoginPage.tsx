import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { WifiOffIcon } from "lucide-react";
import { errorMessage } from "@/shared/api/errors";
import { useConnectivity } from "@/shared/offline/connectivity";
import { Button } from "@/shared/ui/Button";
import { PasswordField } from "@/shared/ui/PasswordField";
import { TextField } from "@/shared/ui/TextField";
import { useLogin } from "../hooks";
import { useAuth } from "../store";

const COMPANY_KEY = "gold.company.v1";

function savedCompany(): string {
  try {
    return localStorage.getItem(COMPANY_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function LoginPage() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const online = useConnectivity((s) => s.online);
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState(savedCompany);
  const [editCompany, setEditCompany] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (status === "authenticated") return <Navigate to={from} replace />;

  const fields = login.error?.fieldErrors;
  const showCompany = editCompany || !!fields?.company;
  const ready = username.trim() !== "" && password !== "" && !login.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const co = company.trim();
    try {
      localStorage.setItem(COMPANY_KEY, co);
    } catch {
      /* private mode: just do not remember it */
    }
    login.mutate({
      username: username.trim(),
      password,
      ...(co ? { company: co } : {}),
    });
  };

  return (
    <main className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      <section
        className="hidden flex-col justify-between bg-navy p-10 text-white lg:flex"
        aria-hidden
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-gold font-serif text-xl font-bold text-navy">
            G
          </span>
          <div>
            <div className="font-serif text-xl tracking-[0.2em]">GILDED</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-gold">
              Gold buying console
            </div>
          </div>
        </div>
        <div className="max-w-md space-y-3">
          <p className="font-serif text-3xl leading-snug">
            Every gram counted, every cedi accounted for.
          </p>
          <p className="text-sm text-white/60">
            Buy, value and track gold across your branches, even when the
            connection drops.
          </p>
        </div>
        <p className="text-xs text-white/40">
          Your sign-in is private to your company.
        </p>
      </section>

      <section className="grid place-items-center p-4 sm:p-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-lg bg-navy font-serif text-lg font-bold text-gold">
              G
            </span>
            <span className="font-serif text-lg tracking-[0.2em]">GILDED</span>
          </div>
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mb-5 text-sm text-muted-foreground">
            Sign in to continue.
          </p>

          {!online ? (
            <p
              role="status"
              className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-500/10 p-3 text-sm"
            >
              <WifiOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                You are offline. Signing in needs a connection. If you were
                already signed in on this device, you can keep working.
              </span>
            </p>
          ) : null}

          <form onSubmit={submit} className="space-y-4" noValidate>
            {showCompany ? (
              <TextField
                label="Company"
                hint="Leave empty to use the default company"
                autoComplete="organization"
                autoCapitalize="none"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                error={fields?.company?.[0]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {company.trim() ? (
                  <>
                    Signing in to{" "}
                    <strong className="text-foreground">
                      {company.trim()}
                    </strong>
                    .{" "}
                  </>
                ) : null}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setEditCompany(true)}
                >
                  {company.trim()
                    ? "Change company"
                    : "Sign in to a different company"}
                </button>
              </p>
            )}
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
                className="rounded-lg bg-red-500/10 p-3 text-sm text-red-700"
              >
                {errorMessage(login.error)}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              loading={login.isPending}
              disabled={!ready}
            >
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Forgot your password? Ask your manager to set a new one for you.
          </p>
        </div>
      </section>
    </main>
  );
}
