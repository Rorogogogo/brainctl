import { useAuthStatus } from '../lib/auth-status.js';

export default function ApiModeBadge() {
  const { status } = useAuthStatus();
  if (!status?.apiMode || status.apiMode === 'prod') return null;

  const isLocal = status.apiMode === 'local';
  const label = isLocal ? 'LOCAL' : 'CUSTOM';
  const className = isLocal
    ? 'bg-amber-100 text-amber-800 border-amber-200'
    : 'bg-violet-100 text-violet-800 border-violet-200';

  return (
    <span
      title={status.apiBaseUrl ?? ''}
      className={`inline-flex h-5 items-center rounded-md border px-1.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}
    >
      {label}
    </span>
  );
}
