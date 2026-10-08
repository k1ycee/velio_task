import type { Executor } from '../db/db.service.js';
import { events } from '../db/schema.js';

export interface EventIds {
  userId?: string | null;
  activityId?: string | null;
  planId?: string | null;
}

/**
 * Writes one row to `events`. Pass the transaction so the event commits
 * (or rolls back) together with the change it describes.
 */
export async function track(db: Executor, name: string, ids: EventIds, props: Record<string, unknown> = {}) {
  await db.insert(events).values({
    name,
    userId: ids.userId ?? null,
    activityId: ids.activityId ?? null,
    planId: ids.planId ?? null,
    props,
  });
}
