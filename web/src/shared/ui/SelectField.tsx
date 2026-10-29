import {
  Children,
  Fragment,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Radix does not allow an empty string as an item value, so "no choice" travels as this stand-in. */
const EMPTY = "__none__";

interface Opt {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** Reads <option> children (also through fragments and .map) so every screen keeps writing plain options. */
function collect(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{
      children?: ReactNode;
      value?: string | number;
      disabled?: boolean;
    }>;
    if (el.type === Fragment) out.push(...collect(el.props.children));
    else if (el.type === "option") {
      const label = el.props.children;
      out.push({
        value: String(
          el.props.value ?? (typeof label === "string" ? label : ""),
        ),
        label,
        disabled: el.props.disabled,
      });
    }
  });
  return out;
}

export interface SelectChange {
  target: { value: string };
}

interface PickerProps {
  value: string;
  onChange?: (e: SelectChange) => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  children: ReactNode;
}

/** The shadcn select with the call shape of a native <select>: `value`, `onChange={(e) => e.target.value}` and <option> children. */
export function SelectInput({
  value,
  onChange,
  disabled,
  invalid,
  className,
  id,
  children,
  ...rest
}: PickerProps) {
  const options = collect(children);
  const shown = options.some((o) => o.value === value) ? value : undefined;
  return (
    <Select
      value={shown === undefined ? "" : shown || EMPTY}
      onValueChange={(v) =>
        onChange?.({ target: { value: v === EMPTY ? "" : v } })
      }
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-invalid={invalid || undefined}
        aria-label={rest["aria-label"]}
        className={className}
      >
        <SelectValue
          placeholder={options.find((o) => o.value === "")?.label ?? "Choose…"}
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem
            key={o.value || EMPTY}
            value={o.value || EMPTY}
            disabled={o.disabled}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A labelled select, styled like TextField. */
export function SelectField({
  label,
  error,
  hint,
  className = "",
  children,
  value,
  onChange,
  disabled,
}: Omit<PickerProps, "invalid" | "id"> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={cn(className)}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <SelectInput
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        invalid={!!error}
      >
        {children}
      </SelectInput>
      {error ? (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
