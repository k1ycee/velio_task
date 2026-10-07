import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DbService } from '../db/db.service.js';
import { LiveService } from '../live/live.service.js';
import { track } from '../track/track.js';

@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly db: DbService,
    private readonly live: LiveService,
  ) {}

  @Interval(60_000)
  async tick() {
    try {
      await this.releaseExpiredHolds();
      await this.sendHoldWarnings();
    } catch (err) {
      this.logger.error('expiry tick failed', err as Error);
    }
  }

  /**
   * Returns every held spot whose plan's window has ended to the activity's open pool.
   * Row locks make this safe against a claim on the same spot: whichever commits first wins,
   * and the other re-checks `status = 'held'` and moves on.
   * Returns the ids of activities whose counts changed.
   */
  async releaseExpiredHolds(now = new Date()): Promise<string[]> {
    const released = await this.db.tx(async (c) => {
      const { rows } = await c.query<{ plan_id: string; activity_id: string; booker_id: string; n: number }>(
        `WITH released AS (
           UPDATE spots s SET status = 'released'
           FROM plans p
           WHERE s.plan_id = p.id AND s.status = 'held' AND p.hold_expires_at <= $1
           RETURNING s.plan_id, s.activity_id, p.booker_id
         )
         SELECT plan_id, activity_id, booker_id, count(*)::int AS n
         FROM released GROUP BY plan_id, activity_id, booker_id`,
        [now],
      );

      const perActivity = new Map<string, number>();
      for (const r of rows) {
        perActivity.set(r.activity_id, (perActivity.get(r.activity_id) ?? 0) + r.n);
        await track(c, 'hold_released', { userId: r.booker_id, activityId: r.activity_id, planId: r.plan_id }, {
          spotsReleased: r.n,
        });
      }
      // Fixed lock order, so two overlapping runs can't deadlock on activity rows.
      for (const [activityId, n] of [...perActivity].sort(([a], [b]) => Number(a) - Number(b))) {
        await c.query(`UPDATE activities SET spots_left = spots_left + $2, version = version + 1 WHERE id = $1`, [
          activityId,
          n,
        ]);
      }
      return [...perActivity.keys()];
    });

    if (released.length) {
      const { rows } = await this.db.pool.query<{ id: string; spots_left: number; version: string }>(
        `SELECT id, spots_left, version FROM activities WHERE id = ANY($1::bigint[])`,
        [released],
      );
      await Promise.all(rows.map((r) => this.live.publish(r.id, r.spots_left, Number(r.version))));
    }
    return released;
  }

  /**
   * Records a 50% / 90% warning once per plan that still has held spots to fill.
   * ponytail: tracked as an event + shown in the booker UI; no email is sent yet (Plans.MD, Stubbed).
   */
  async sendHoldWarnings(now = new Date()) {
    await this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string; activity_id: string; booker_id: string; pct: number; held: number }>(
        `WITH due AS (
           SELECT p.id,
                  CASE WHEN $1 >= p.created_at + (p.hold_expires_at - p.created_at) * 0.9 THEN 90
                       WHEN $1 >= p.created_at + (p.hold_expires_at - p.created_at) * 0.5 THEN 50
                       ELSE 0 END AS pct,
                  (SELECT count(*)::int FROM spots s WHERE s.plan_id = p.id AND s.status = 'held') AS held
           FROM plans p
           WHERE p.hold_expires_at > $1 AND p.warned_pct < 90
         )
         UPDATE plans p SET warned_pct = due.pct
         FROM due
         WHERE p.id = due.id AND due.held > 0 AND due.pct > p.warned_pct
         RETURNING p.id, p.activity_id, p.booker_id, due.pct, due.held`,
        [now],
      );
      for (const r of rows) {
        await track(c, 'hold_warning_sent', { userId: r.booker_id, activityId: r.activity_id, planId: r.id }, {
          pct: r.pct,
          heldSpotsLeft: r.held,
        });
      }
    });
  }
}
