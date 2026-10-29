import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert } from "antd";
import { CheckIcon, CircleIcon } from "lucide-react";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useChangeMyPassword, useMySecurity } from "@/features/users/api";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
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
      className={`flex items-center gap-2 text-sm ${ok ? "text-emerald-700" : "text-muted-foreground"}`}
    >
      {ok ? (
        <CheckIcon className="size-4" aria-label="Done" />
      ) : (
        <CircleIcon className="size-4" aria-label="Not yet" />
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
    <div className="mx-auto max-w-md space-y-4 p-3 pb-8 sm:p-4">
      <div>
        <h1 className="text-xl font-bold">
          {forced ? "Choose your own password" : "Change my password"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {user?.displayName}
          {user?.username ? ` · ${user.username}` : ""}
        </p>
      </div>
      {forced ? (
        <Alert
          type="info"
          showIcon
          title="The password you signed in with was set for you. Choose one only you know, then carry on."
        />
      ) : null}
      <Card>
        <form
          className="space-y-4"
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
              <div className="mt-2" aria-live="polite">
                <div className="flex gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 flex-1 rounded-full ${i <= strength.score ? bar[strength.score] : "bg-muted"}`}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
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
          <ul className="space-y-1" aria-label="What a good password needs">
            <Rule ok={longEnough}>At least {MIN} characters</Rule>
            <Rule ok={different}>Different from the current one</Rule>
            <Rule ok={matches}>Both new passwords the same</Rule>
          </ul>
          {change.error && !change.error.fieldErrors ? (
            <Alert type="error" showIcon title={change.error.message} />
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={!ok}
            loading={change.isPending}
          >
            Save password
          </Button>
        </form>
      </Card>
      {!forced ? (
        <Link to={paths.home.href} className="text-sm underline">
          Back
        </Link>
      ) : null}
    </div>
  );
}
