import { Toaster, toast as sonner } from 'sonner';

/** Same tiny API as before (toast.success/error/info), now on sonner like SchoolMate. Works outside React too. */
export const toast = {
  success: (text: string) => sonner.success(text),
  error: (text: string) => sonner.error(text, { duration: 6000 }),
  info: (text: string) => sonner.info(text),
};

export function ToastViewport() {
  return <Toaster richColors closeButton position="top-center" offset={{ top: 'max(12px, env(safe-area-inset-top))' }} />;
}
