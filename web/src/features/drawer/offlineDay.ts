import type { DrawerView } from "@gold/core";

/**
 * Should an opening or closing be saved on this device and sent in order, instead of being sent straight away?
 * Yes when there is no connection, when the day itself only exists on this device so far, or when this device still holds
 * entries the server has not received: the server must get those first, or its books would be behind the count.
 */
export const mustQueue = (
  view: Pick<DrawerView, "local" | "pendingCount">,
  online: boolean,
): boolean => !online || view.local || view.pendingCount > 0;

/** The computer's date is before the last day it knows: its clock is wrong, and a day opened now would be dated in the past. */
export const clockBehind = (
  today: string,
  lastKnownDate: string | null,
): boolean => !!lastKnownDate && today < lastKnownDate;
