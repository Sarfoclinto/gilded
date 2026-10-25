import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert } from "antd";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useChangeMyPassword, useMySecurity } from "@/features/users/api";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { TextField } from "@/shared/ui/TextField";
import { toast } from "@/shared/ui/toast";

const MIN = 10;

/** Opened by itself when an administrator set the password, and by anyone who wants to change theirs. */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const forced = useMySecurity(true).data?.mustChangePassword ?? false;
  const change = useChangeMyPassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");

  const problem =
    next.length > 0 && next.length < MIN
      ? `Use at least ${MIN} characters.`
      : next !== "" && next === current
        ? "Choose a password different from the current one."
        : null;
  const mismatch =
    again !== "" && again !== next
      ? "The two new passwords are not the same."
      : null;
  const ok =
    current !== "" &&
    next.length >= MIN &&
    next !== current &&
    again === next &&
    !change.isPending;
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
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-bold">
        {forced ? "Choose your own password" : "Change my password"}
      </h1>
      {forced ? (
        <Alert
          type="info"
          showIcon
          title={`Hello ${user?.displayName ?? ""}. The password you signed in with was set for you. Choose one only you know.`}
        />
      ) : null}
      <Card className="space-y-3">
        <TextField
          label={forced ? "Password you signed in with" : "Current password"}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={fields.currentPassword?.[0]}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={problem ?? fields.newPassword?.[0]}
          hint={`At least ${MIN} characters. A few words together are easy to remember and hard to guess.`}
        />
        <TextField
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          error={mismatch ?? undefined}
        />
        {change.error && !change.error.fieldErrors ? (
          <Alert type="error" showIcon title={change.error.message} />
        ) : null}
        <Button
          className="w-full"
          onClick={submit}
          disabled={!ok}
          loading={change.isPending}
        >
          Save password
        </Button>
      </Card>
      {!forced ? (
        <Link to={paths.home.href} className="text-sm underline">
          Back
        </Link>
      ) : null}
    </div>
  );
}
