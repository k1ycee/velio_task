import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { pgCode } from '../common/http.js';
import { DbService } from '../db/db.service.js';
import { activities, plans, spots } from '../db/schema.js';
import { LiveService } from '../live/live.service.js';
import { holdExpiresAt } from '../hold-window.js';
import { readSetting } from '../settings.js';
import { track } from '../track/track.js';

class NotEnoughSpots {
  constructor(
    readonly available: number,
    readonly requested: number,
  ) {}
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly db: DbService,
    private readonly live: LiveService,
  ) {}

  /** Books the booker's own spot plus `heldSpots` for friends, all or nothing. */
  async book(bookerId: string, activityId: string, heldSpots: number) {
    const requested = heldSpots + 1;
    try {
      const result = await this.db.tx(async (tx) => {
        // ponytail: one cap for everyone; fill-rate-based caps are deferred (PLANS.md).
        const cap = await readSetting<number>(tx, 'new_user_cap');
        if (heldSpots > cap) {
          throw new UnprocessableEntityException({ message: `at most ${cap} held spots`, cap });
        }

        // The oversell guard: the conditional decrement only succeeds if enough spots remain.
        const [activity] = await tx
          .update(activities)
          .set({ spotsLeft: sql`${activities.spotsLeft} - ${requested}`, version: sql`${activities.version} + 1` })
          .where(
            and(eq(activities.id, activityId), gte(activities.spotsLeft, requested), gt(activities.startsAt, sql`now()`)),
          )
          .returning({ spotsLeft: activities.spotsLeft, version: activities.version, startsAt: activities.startsAt });
        if (!activity) {
          const [cur] = await tx
            .select({ spotsLeft: activities.spotsLeft, startsAt: activities.startsAt })
            .from(activities)
            .where(eq(activities.id, activityId));
          if (!cur) throw new NotFoundException('activity not found');
          if (cur.startsAt <= new Date()) throw new BadRequestException('activity has already started');
          throw new NotEnoughSpots(cur.spotsLeft, requested);
        }

        const expiresAt = holdExpiresAt(activity.startsAt, new Date());
        const [plan] = await tx
          .insert(plans)
          .values({ activityId, bookerId, holdExpiresAt: expiresAt })
          .returning({ id: plans.id });
        const planId = plan.id;

        // The booker's own spot first, then one held spot per friend.
        await tx.insert(spots).values([
          { planId, activityId, status: 'booker', userId: bookerId },
          ...Array.from({ length: heldSpots }, () => ({ planId, activityId, status: 'held' as const })),
        ]);

        await track(tx, 'booking_created', { userId: bookerId, activityId, planId }, {
          spotsHeld: heldSpots,
          holdExpiresAt: expiresAt.toISOString(),
        });

        return {
          planId,
          holdExpiresAt: expiresAt.toISOString(),
          spotsLeft: activity.spotsLeft,
          version: activity.version,
        };
      });
      await this.live.publish(activityId, result.spotsLeft, result.version);
      return result;
    } catch (err) {
      if (err instanceof NotEnoughSpots) {
        await track(this.db.orm, 'booking_failed', { userId: bookerId, activityId }, {
          reason: 'race_lost',
          requested: err.requested,
          available: err.available,
        });
        throw new ConflictException({ reason: 'race_lost', available: err.available });
      }
      const isExpected = err instanceof HttpException || pgCode(err) === '23505';
      if (!isExpected) {
        await track(this.db.orm, 'booking_failed', { userId: bookerId, activityId }, { reason: 'error' }).catch(
          () => undefined,
        );
      }
      throw err;
    }
  }
}
