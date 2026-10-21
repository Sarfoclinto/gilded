import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
const styles: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'border border-line bg-surface text-ink hover:bg-line/40',
  ghost: 'text-muted hover:bg-line/40',
};

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {loading ? 'Please wait…' : children}
    </button>
  );
}
