import pg from 'pg';

export interface EventIds {
  userId?: string | null;
  activityId?: string | null;
  planId?: string | null;
}

/**
 * Writes one row to `events`. Pass the transaction client so the event commits
 * (or rolls back) together with the change it describes.
 */
export async function track(
  c: pg.Pool | pg.PoolClient,
  name: string,
  ids: EventIds,
  props: Record<string, unknown> = {},
) {
  await c.query(`INSERT INTO events (name, user_id, activity_id, plan_id, props) VALUES ($1, $2, $3, $4, $5)`, [
    name,
    ids.userId ?? null,
    ids.activityId ?? null,
    ids.planId ?? null,
    props,
  ]);
}
