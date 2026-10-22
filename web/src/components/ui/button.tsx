import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** shadcn-style button. `components/ui` holds the small polished pieces; AntD does the heavy ones. */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'default', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      {
        'bg-primary text-primary-foreground hover:bg-primary/90': variant === 'default',
        'border border-input bg-background hover:bg-accent hover:text-accent-foreground': variant === 'outline',
        'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
        'bg-destructive text-white hover:bg-destructive/90': variant === 'destructive',
      },
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';

export { Button };
