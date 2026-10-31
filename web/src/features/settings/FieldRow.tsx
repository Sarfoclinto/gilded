import { Input, InputNumber, Segmented, Switch } from "antd";
import { wholeNumber, type Field } from "./model";

/** One setting as a row: its name and help on the left, its control on the right (under it on a phone). */
export function FieldRow({
  field,
  value,
  disabled,
  onChange,
}: {
  field: Field;
  value: unknown;
  disabled?: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `setting-${field.key}`;
  const control = (() => {
    switch (field.kind) {
      case "toggle":
        return (
          <Switch
            id={id}
            checked={value === true}
            disabled={disabled}
            onChange={(v) => onChange(v)}
            aria-label={field.label}
          />
        );
      case "choice":
        return (
          <Segmented
            options={(field.choices ?? []).map((c) => ({
              value: c.value,
              label: c.label,
            }))}
            value={String(value)}
            onChange={(v) => onChange(String(v))}
            disabled={disabled}
            aria-label={field.label}
          />
        );
      case "number":
        return (
          <InputNumber
            id={id}
            size="large"
            min={0}
            max={field.max}
            precision={0}
            value={typeof value === "number" ? value : null}
            addonBefore={field.unit}
            disabled={disabled}
            className="w-40"
            onChange={(v) => {
              const n =
                v === null
                  ? null
                  : wholeNumber(String(v), field.max ?? 1_000_000);
              if (n !== null) onChange(n);
            }}
            aria-label={field.label}
          />
        );
      case "text":
        return (
          <Input
            id={id}
            size="large"
            value={String(value ?? "")}
            maxLength={field.max ?? 200}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-label={field.label}
            className="w-full sm:w-80"
          />
        );
    }
  })();

  return (
    <div
      className={`flex flex-col gap-2 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6 ${disabled ? "opacity-60" : ""}`}
    >
      <div className="min-w-0 sm:max-w-md">
        <label htmlFor={id} className="text-sm font-semibold">
          {field.label}
        </label>
        {field.help ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{field.help}</p>
        ) : null}
        {disabled && field.needs ? (
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
            Turn on two-step payout first.
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
