import { Input, InputNumber, Segmented, Select, Switch } from "antd";
import { useAllBranches } from "@/features/branches/api";
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
  const allBranches = useAllBranches().data ?? [];
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
      case "branches":
        return (
          <Select
            id={id}
            mode="multiple"
            size="large"
            className="w-full sm:w-80"
            value={Array.isArray(value) ? (value as string[]) : []}
            placeholder={field.placeholder}
            options={allBranches.map((b) => ({ value: b.id, label: b.name }))}
            optionFilterProp="label"
            disabled={disabled}
            onChange={(v) => onChange(v)}
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

  const inline = field.kind === "toggle";
  return (
    <div
      className={`flex gap-3 px-4 py-4 transition-opacity sm:px-5 ${inline ? "items-center justify-between gap-6" : "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-8"} ${disabled ? "opacity-60" : ""}`}
    >
      <div className="min-w-0 sm:max-w-md">
        <label htmlFor={id} className="text-sm font-semibold">
          {field.label}
        </label>
        {field.help ? (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {field.help}
          </p>
        ) : null}
        {disabled && field.needs ? (
          <p className="mt-1 text-xs font-medium text-amber-800">
            Turn on two-step payout first.
          </p>
        ) : null}
      </div>
      <div
        className={`shrink-0 ${inline ? "" : "w-full sm:w-auto [&_.ant-segmented]:w-full sm:[&_.ant-segmented]:w-auto"}`}
      >
        {control}
      </div>
    </div>
  );
}
