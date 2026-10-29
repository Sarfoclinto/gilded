/** "Today", "Yesterday", "3 days ago", "2 weeks ago", "5 months ago", "over a year ago". Whole calendar days, in the person's own time zone. */
export function ago(iso: string, now: Date = new Date()): string {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return "Over a year ago";
}

/** "Kofi Boateng" -> "KB", "Ama" -> "A". For the round badge next to a name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  return (
    parts.length > 1 ? first + parts[parts.length - 1]!.charAt(0) : first
  ).toUpperCase();
}
