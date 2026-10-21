import { useId, type InputHTMLAttributes } from 'react';

export function TextField({
  label,
  error,
  hint,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        {...rest}
        className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 aria-[invalid=true]:border-red-500"
      />
      {error ? (
        <p id={`${id}-e`} className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-h`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
