import { useState } from "react";
import { Alert, Modal } from "antd";
import { Button } from "@/shared/ui/Button";
import { TextField } from "@/shared/ui/TextField";
import { useResetPassword } from "./api";
import { temporaryPassword } from "./diff";
import type { ManagedUser } from "./schemas";

function Form({
  user,
  onDone,
}: {
  user: ManagedUser;
  onDone: (password: string) => void;
}) {
  const reset = useResetPassword();
  const [password, setPassword] = useState(() => temporaryPassword());
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {user.displayName} will be signed out everywhere and must choose a new
        password at the next sign-in.
      </p>
      <TextField
        label="Temporary password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="off"
        hint="At least 10 characters."
      />
      {reset.error ? (
        <Alert type="error" showIcon title={reset.error.message} />
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => setPassword(temporaryPassword())}
        >
          Make another
        </Button>
        <Button
          className="flex-1"
          disabled={password.length < 10}
          loading={reset.isPending}
          onClick={() =>
            reset.mutate(
              { id: user.id, password },
              { onSuccess: () => onDone(password) },
            )
          }
        >
          Set password
        </Button>
      </div>
    </div>
  );
}

export function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: ManagedUser | null;
  onClose: () => void;
  onDone: (u: ManagedUser, password: string) => void;
}) {
  return (
    <Modal
      open={!!user}
      onCancel={onClose}
      title={user ? `Reset password for ${user.displayName}` : ""}
      footer={null}
      destroyOnHidden
    >
      {user ? <Form user={user} onDone={(pw) => onDone(user, pw)} /> : null}
    </Modal>
  );
}
