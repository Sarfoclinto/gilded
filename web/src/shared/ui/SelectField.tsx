import { useId, type SelectHTMLAttributes } from "react";

/** A labelled native select, styled like TextField. Native on purpose: it is the best picker on a phone. */
export function SelectField({
  label,
  error,
  hint,
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={!!error}
        {...rest}
        className="min-h-11 w-full rounded-lg border border-border bg-card px-2 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 aria-[invalid=true]:border-red-500"
      >
        {children}
      </select>
      {error ? (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
