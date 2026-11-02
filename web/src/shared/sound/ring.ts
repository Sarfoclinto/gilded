import { usePersonalSettings } from "@/features/settings/personal";

let audio: HTMLAudioElement | null = null;

/**
 * The little ring heard when a notification arrives. A person can switch it off in My settings. Browsers refuse to play sound until the
 * person has touched the page once; when that happens the ring is simply skipped (the notification still shows).
 */
export function ring(force = false): void {
  try {
    if (!force && !usePersonalSettings.getState().notifySound) return;
    audio ??= new Audio(`${import.meta.env.BASE_URL}sounds/notify.mp3`);
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    /* no sound is never a problem */
  }
}
