import { useConnectivity } from '@/shared/offline/connectivity';

export function ConnectionBadge() {
  const online = useConnectivity((s) => s.online);
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        online ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}
