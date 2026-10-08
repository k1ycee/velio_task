import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { activities, plans, spots } from '../db/schema.js';
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
    const released = await this.db.tx(async (tx) => {
      const rows = await tx
        .update(spots)
        .set({ status: 'released' })
        .from(plans)
        .where(and(eq(spots.planId, plans.id), eq(spots.status, 'held'), lte(plans.holdExpiresAt, now)))
        .returning({ planId: spots.planId, activityId: spots.activityId, bookerId: plans.bookerId });

      // One hold_released event per plan, and one count change per activity.
      const perPlan = new Map<string, { activityId: string; bookerId: string; n: number }>();
      const perActivity = new Map<string, number>();
      for (const r of rows) {
        const plan = perPlan.get(r.planId) ?? { activityId: r.activityId, bookerId: r.bookerId, n: 0 };
        plan.n++;
        perPlan.set(r.planId, plan);
        perActivity.set(r.activityId, (perActivity.get(r.activityId) ?? 0) + 1);
      }
      for (const [planId, p] of perPlan) {
        await track(tx, 'hold_released', { userId: p.bookerId, activityId: p.activityId, planId }, {
          spotsReleased: p.n,
        });
      }
      // Fixed lock order, so two overlapping runs can't deadlock on activity rows.
      for (const [activityId, n] of [...perActivity].sort(([a], [b]) => Number(a) - Number(b))) {
        await tx
          .update(activities)
          .set({ spotsLeft: sql`${activities.spotsLeft} + ${n}`, version: sql`${activities.version} + 1` })
          .where(eq(activities.id, activityId));
      }
      return [...perActivity.keys()];
    });

    if (released.length) {
      const rows = await this.db.orm
        .select({ id: activities.id, spotsLeft: activities.spotsLeft, version: activities.version })
        .from(activities)
        .where(inArray(activities.id, released));
      await Promise.all(rows.map((r) => this.live.publish(r.id, r.spotsLeft, r.version)));
    }
    return released;
  }

  /**
   * Records a 50% / 90% warning once per plan that still has held spots to fill.
   * ponytail: tracked as an event + shown in the booker UI; no email is sent yet (PLANS.md, Stubbed).
   */
  async sendHoldWarnings(now = new Date()) {
    // How far through its hold window a plan is, as the warning level it has reached: 0, 50 or 90.
    const reached = (share: number) =>
      sql`${plans.createdAt} + (${plans.holdExpiresAt} - ${plans.createdAt}) * ${share}`;
    const pct = sql<number>`CASE WHEN ${now} >= ${reached(0.9)} THEN 90
                                 WHEN ${now} >= ${reached(0.5)} THEN 50 ELSE 0 END`;

    await this.db.tx(async (tx) => {
      // A nested builder, not a sql`` string: Drizzle drops table names from columns in a RETURNING
      // list, which would turn a hand-written correlated subquery into spots.plan_id = spots.id.
      const held = sql<number>`(${tx
        .select({ n: sql`count(*)::int` })
        .from(spots)
        .where(and(eq(spots.planId, plans.id), eq(spots.status, 'held')))})`;
      const rows = await tx
        .update(plans)
        .set({ warnedPct: pct })
        .where(and(gt(plans.holdExpiresAt, now), lt(plans.warnedPct, pct), gt(held, 0)))
        .returning({ id: plans.id, activityId: plans.activityId, bookerId: plans.bookerId, pct: plans.warnedPct, held });
      for (const r of rows) {
        await track(tx, 'hold_warning_sent', { userId: r.bookerId, activityId: r.activityId, planId: r.id }, {
          pct: r.pct,
          heldSpotsLeft: r.held,
        });
      }
    });
  }
}
