import {
  useId,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

/** A password box with a show/hide button and a warning while Caps Lock is on. */
export function PasswordField({
  label,
  error,
  hint,
  className = "",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  error?: string | undefined;
  hint?: string;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const watch = (e: KeyboardEvent<HTMLInputElement>) =>
    setCaps(e.getModifierState("CapsLock"));
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? "text" : "password"}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
          onKeyUp={watch}
          onKeyDown={watch}
          onBlur={() => setCaps(false)}
          {...rest}
          className="min-h-11 w-full rounded-lg border border-border bg-card pl-3 pr-11 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 aria-[invalid=true]:border-red-500"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          {shown ? (
            <EyeOffIcon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </button>
      </div>
      {caps ? (
        <p className="mt-1 text-xs font-medium text-amber-700">
          Caps Lock is on.
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-e`} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-h`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
