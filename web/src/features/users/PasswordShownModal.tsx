import { useState } from "react";
import { Modal } from "antd";
import { Button } from "@/shared/ui/Button";

/** The temporary password is shown once, here. Afterwards nobody can read it again. */
export function PasswordShownModal({
  who,
  password,
  onClose,
}: {
  who: string;
  password: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      open={!!password}
      onCancel={onClose}
      title={`Temporary password for ${who}`}
      footer={<Button onClick={onClose}>Done</Button>}
      destroyOnHidden
    >
      <p className="text-sm text-muted-foreground">
        Give this to {who} in person or by a private message. They must choose
        their own password when they sign in. It cannot be shown again.
      </p>
      <div
        className="my-4 rounded-lg bg-muted p-4 text-center font-mono text-2xl tracking-wider"
        data-testid="temp-password"
      >
        {password}
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(password ?? "")
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </Modal>
  );
}
