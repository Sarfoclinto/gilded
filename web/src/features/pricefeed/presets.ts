import type { FeedWindow } from "./api";

export interface Preset {
  key: string;
  label: string;
  help: string;
  windows: FeedWindow[];
}

/** Ready-made check times. Between a start and an end the system looks every N minutes and stops as soon as the new price is found. */
export const PRESETS: Preset[] = [
  {
    key: "goldbod",
    label: "GoldBod times",
    help: "Looks 10:30 to 11:30 and 15:00 to 16:00, every 5 minutes, until each new price arrives.",
    windows: [
      { start: "10:30", end: "11:30", everyMinutes: 5 },
      { start: "15:00", end: "16:00", everyMinutes: 5 },
    ],
  },
  {
    key: "earlier",
    label: "Earlier times",
    help: "The previous timetable: 09:30 to 10:30 and 14:30 to 15:30.",
    windows: [
      { start: "09:30", end: "10:30", everyMinutes: 5 },
      { start: "14:30", end: "15:30", everyMinutes: 5 },
    ],
  },
  {
    key: "wide",
    label: "Wide net",
    help: "Covers a changed timetable: 09:00 to 12:00 and 14:00 to 17:00, every 10 minutes.",
    windows: [
      { start: "09:00", end: "12:00", everyMinutes: 10 },
      { start: "14:00", end: "17:00", everyMinutes: 10 },
    ],
  },
  {
    key: "day",
    label: "All working day",
    help: "Every 30 minutes from 06:00 to 20:00. Uses more requests but never misses a change.",
    windows: [{ start: "06:00", end: "20:00", everyMinutes: 30 }],
  },
];

export const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export const sameWindows = (a: FeedWindow[], b: FeedWindow[]) =>
  a.length === b.length &&
  a.every(
    (w, i) =>
      w.start === b[i]!.start &&
      w.end === b[i]!.end &&
      w.everyMinutes === b[i]!.everyMinutes,
  );

/** Problems with the check times, in plain words. Empty when fine. */
export function windowProblems(windows: FeedWindow[]): string[] {
  const out: string[] = [];
  if (windows.length === 0) out.push("Add at least one check time.");
  windows.forEach((w, i) => {
    if (!/^\d{2}:\d{2}$/.test(w.start) || !/^\d{2}:\d{2}$/.test(w.end))
      out.push(`Check time ${i + 1}: choose a start and an end.`);
    else if (w.start >= w.end)
      out.push(`Check time ${i + 1}: the end must be after the start.`);
    if (!(w.everyMinutes >= 1 && w.everyMinutes <= 120))
      out.push(`Check time ${i + 1}: look every 1 to 120 minutes.`);
  });
  const sorted = [...windows]
    .filter((w) => w.start < w.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i]!.start < sorted[i - 1]!.end)
      out.push("Two check times overlap. Join them into one.");
  return out;
}
