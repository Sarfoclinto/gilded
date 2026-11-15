import { useProfilePicture } from "./api";
import { useProfileVersion } from "./profileVersion";

export const initialsOf = (name?: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** A person's profile picture, or their initials on gold while they have none (or while it loads). */
export function Avatar({
  userId,
  name,
  className = "size-8 text-xs",
}: {
  userId?: string | null;
  name?: string | null;
  className?: string;
}) {
  const version = useProfileVersion((s) => s.version);
  const url = useProfilePicture(userId ?? undefined, version);
  return url ? (
    <img
      src={url}
      alt=""
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  ) : (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#C9A84C] to-[#E8C97A] font-bold text-[#0D1B2E] ${className}`}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
