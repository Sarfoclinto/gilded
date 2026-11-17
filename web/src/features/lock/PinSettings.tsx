import { useState } from "react";
import { Modal } from "antd";
import { useAuth } from "@/features/auth/store";
import { useSettings } from "@/features/settings/api";
import { Button } from "@/shared/ui/Button";
import { PasswordField } from "@/shared/ui/PasswordField";
import { TextField } from "@/shared/ui/TextField";
import { toast } from "@/shared/ui/toast";
import { pinFor, pinProblem, removePin, setPin, PIN_MAX } from "./pin";
import { useLock } from "./store";
import { verifyPassword } from "./verifyPassword";

/** My settings: the PIN that unlocks this device, and how soon it locks. The PIN never leaves this device. */
export function PinSettings({
  Row,
}: {
  Row: (p: {
    title: string;
    help?: string;
    inline?: boolean;
    children: React.ReactNode;
  }) => React.ReactNode;
}) {
  const user = useAuth((s) => s.user);
  const minutes = useSettings()["session.lockMinutes"];
  const [version, setVersion] = useState(0);
  const rec = user ? pinFor(user.id) : undefined;
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pin, setPinValue] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  void version;

  const reset = () => {
    setPassword("");
    setPinValue("");
    setAgain("");
    setErr(null);
  };
  const save = async () => {
    if (!user) return;
    const p = pinProblem(pin);
    if (p) return setErr(p);
    if (pin !== again) return setErr("The two PINs are different.");
    setBusy(true);
    const r = await verifyPassword(password);
    if (r !== "ok") {
      setBusy(false);
      return setErr(
        r === "cannot-check"
          ? "Your password cannot be checked with no connection. Try again when online."
          : "That password is not right.",
      );
    }
    await setPin(user.id, pin);
    setBusy(false);
    setOpen(false);
    reset();
    setVersion((v) => v + 1);
    toast.success("PIN saved on this device");
  };

  return (
    <>
      <Row
        inline
        title="Lock after"
        help={
          minutes > 0
            ? `This device locks after ${minutes} minute${minutes === 1 ? "" : "s"} with no activity (your company's setting).`
            : "Your company has the automatic lock switched off. You can still lock from your account menu."
        }
      >
        <Button
          variant="secondary"
          onClick={() => user && useLock.getState().lockNow(user.id, "manual")}
        >
          Lock now
        </Button>
      </Row>
      <Row
        inline
        title="Unlock PIN"
        help={
          rec
            ? `A ${rec.length}-digit PIN is set on this device. It works with no connection. Five wrong PINs sign you out.`
            : "Set a 4 to 6 digit PIN to unlock quickly. It is kept only on this device; on another device, set one there too. Without it, your password unlocks."
        }
      >
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            {rec ? "Change" : "Set a PIN"}
          </Button>
          {rec ? (
            <Button
              variant="ghost"
              onClick={() => {
                if (
                  user &&
                  window.confirm(
                    "Remove the PIN from this device? Your password will unlock instead.",
                  )
                ) {
                  removePin(user.id);
                  setVersion((v) => v + 1);
                  toast.success("PIN removed");
                }
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </Row>
      <Modal
        open={open}
        title={rec ? "Change your PIN" : "Set a PIN for this device"}
        okText="Save PIN"
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        destroyOnHidden
      >
        <div className="space-y-3">
          <PasswordField
            label="Your password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="New PIN"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_MAX}
            value={pin}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
            hint="4 to 6 digits. Not all the same digit, and not a run like 1234."
          />
          <TextField
            label="The same PIN again"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_MAX}
            value={again}
            onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))}
          />
          {err ? (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-2 text-sm text-red-800"
            >
              {err}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
