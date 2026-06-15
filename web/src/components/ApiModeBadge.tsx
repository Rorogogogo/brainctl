import { useAuthStatus } from '../lib/auth-status.js';
import { Badge } from './ui/badge.js';

export default function ApiModeBadge() {
  const { status } = useAuthStatus();
  if (!status?.apiMode || status.apiMode === 'prod') return null;

  const isLocal = status.apiMode === 'local';
  return (
    <Badge variant={isLocal ? 'warning' : 'info'} title={status.apiBaseUrl ?? ''}>
      {isLocal ? 'LOCAL' : 'CUSTOM'}
    </Badge>
  );
}
