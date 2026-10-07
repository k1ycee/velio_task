export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface User {
  id: string;
  name: string;
}

export interface Activity {
  id: string;
  hostId: string;
  title: string;
  startsAt: string;
  capacity: number;
  spotsLeft: number;
  version: number;
}

export interface Invite {
  inviteId: string;
  type: 'vouch' | 'public';
  token: string;
  label: string | null;
  used: boolean;
  url: string;
}

export interface Plan {
  id: string;
  bookerId: string;
  activity: Activity;
  holdStartedAt: string;
  holdExpiresAt: string;
  warnedPct: number;
  heldSpotsLeft: number;
  members: { userId: string; name: string; role: 'booker' | 'guest'; inviteType: Invite['type'] | null }[];
  invites: Invite[];
}

export interface PlanSummary {
  id: string;
  holdExpiresAt: string;
  activity: Activity;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown> | null;

  constructor(status: number, body: Record<string, unknown> | null) {
    const msg = body?.message;
    super(Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

/** JSON fetch against velio_server. `userId` becomes the X-User-Id identity header. */
export async function api<T>(path: string, opts: { body?: unknown; userId?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.userId) headers['X-User-Id'] = opts.userId;
  const res = await fetch(API_URL + path, {
    method: opts.body === undefined ? 'GET' : 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
