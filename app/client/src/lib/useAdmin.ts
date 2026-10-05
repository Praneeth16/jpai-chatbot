import type { MeResponse } from '../../../shared/api.ts';
import { getMe } from './api.ts';
import { useAsync } from './useAsync.ts';

let cached: Promise<MeResponse> | null = null;

/** One /api/me request per page load. Any failure means "not an admin": the admin views fail closed. */
function loadMe(): Promise<MeResponse> {
  cached ??= getMe().catch(() => ({ email: null, is_admin: false }));
  return cached;
}

/** True when the server says the caller is in ADMIN_EMAILS. The server enforces it; this only hides controls. */
export function useIsAdmin(): boolean {
  const { state } = useAsync(loadMe);
  return state.status === 'ok' && state.data.is_admin;
}
