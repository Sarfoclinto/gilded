import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert } from "antd";
import { CheckIcon, CircleIcon, ShieldCheckIcon } from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useChangeMyPassword, useMySecurity } from "@/features/users/api";
import { CoinEdge } from "@/shared/ui/BrandMark";
import { PasswordField } from "@/shared/ui/PasswordField";
import { toast } from "@/shared/ui/toast";
import { MIN_PASSWORD as MIN, passwordStrength } from "../passwordStrength";

const bar = [
  "bg-muted",
  "bg-red-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-600",
];

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors ${ok ? "bg-emerald-500/10 text-emerald-800" : "bg-muted text-muted-foreground"}`}
    >
      {ok ? (
        <CheckIcon className="size-4 shrink-0" aria-label="Done" />
      ) : (
        <CircleIcon className="size-4 shrink-0" aria-label="Not yet" />
      )}
      {children}
    </li>
  );
}

/** Opened by itself when an administrator set the password, and by anyone who wants to change theirs. */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const forced = useMySecurity(true).data?.mustChangePassword ?? false;
  const change = useChangeMyPassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");

  const strength = passwordStrength(next);
  const longEnough = next.length >= MIN;
  const different = next !== "" && next !== current;
  const matches = again !== "" && again === next;
  const ok =
    current !== "" && longEnough && different && matches && !change.isPending;
  const fields = change.error?.fieldErrors ?? {};

  function submit() {
    if (!ok) return;
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success("Your new password is saved");
          navigate(paths.home.href, { replace: true });
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-3 pb-10 sm:p-4 lg:p-6">
      <header className="relative isolate overflow-hidden rounded-2xl bg-navy p-5 text-white sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_90%_at_90%_10%,rgba(201,168,76,0.2),transparent_70%)]"
        />
        <CoinEdge className="pointer-events-none absolute -right-14 -top-16 -z-10 size-56 text-gold/35 sm:size-72" />
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold/20 text-gold"
          >
            <ShieldCheckIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">
              {forced ? "Choose your own password" : "Change my password"}
            </h1>
            <p className="truncate text-sm text-white/65">
              {user?.displayName}
              {user?.username ? ` · ${user.username}` : ""}
            </p>
          </div>
        </div>
      </header>

      {forced ? (
        <Alert
          type="info"
          showIcon
          title="The password you signed in with was set for you. Choose one only you know, then carry on."
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <form
          className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(13,27,46,0.04)] sm:p-6 [&_input]:min-h-12 [&_input]:rounded-xl [&_input:focus]:border-gold [&_input:focus]:ring-gold/30"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <PasswordField
            label={forced ? "Password you signed in with" : "Current password"}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={fields.currentPassword?.[0]}
          />
          <div>
            <PasswordField
              label="New password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              error={fields.newPassword?.[0]}
              hint="A few words together are easy to remember and hard to guess."
            />
            {next ? (
              <div className="mt-3" aria-live="polite">
                <div className="flex gap-1.5" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-colors ${i <= strength.score ? bar[strength.score] : "bg-muted"}`}
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-sm font-medium text-foreground/80">
                  {strength.label}
                </p>
              </div>
            ) : null}
          </div>
          <PasswordField
            label="New password again"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          <ul
            className="flex flex-wrap gap-2"
            aria-label="What a good password needs"
          >
            <Rule ok={longEnough}>At least {MIN} characters</Rule>
            <Rule ok={different}>Different from the current one</Rule>
            <Rule ok={matches}>Both new passwords the same</Rule>
          </ul>
          {change.error && !change.error.fieldErrors ? (
            <Alert type="error" showIcon title={change.error.message} />
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            {!forced ? (
              <Link
                to={paths.home.href}
                className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                Back
              </Link>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={!ok}
              className="relative inline-flex min-h-12 items-center justify-center overflow-hidden rounded-xl bg-navy px-8 text-sm font-semibold text-white transition hover:bg-[#13294a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50 sm:min-w-44"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent"
              />
              {change.isPending ? "Saving…" : "Save password"}
            </button>
          </div>
        </form>

        <aside className="rounded-2xl border border-gold/40 bg-gold/10 p-5 text-sm leading-relaxed">
          <h2 className="mb-2 text-base font-semibold">Keep it yours</h2>
          <ul className="list-disc space-y-2 pl-4 text-foreground/80">
            <li>
              Use a few words you can picture, not one word with a number.
            </li>
            <li>
              Do not share it, not even with your manager. If you forget it,
              they can set a new one for you.
            </li>
            <li>On a shared computer, sign out when you leave.</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
