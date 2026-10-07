import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DbService } from '../db/db.service.js';
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
  constructor(private readonly db: DbService) {}

  /** Books the booker's own spot plus `heldSpots` for friends, all or nothing. */
  async book(bookerId: string, activityId: string, heldSpots: number) {
    const requested = heldSpots + 1;
    try {
      return await this.db.tx(async (c) => {
        // ponytail: one cap for everyone; fill-rate-based caps are deferred (Plans.MD).
        const cap = await readSetting<number>(c, 'new_user_cap');
        if (heldSpots > cap) {
          throw new UnprocessableEntityException({ message: `at most ${cap} held spots`, cap });
        }

        // The oversell guard: the conditional decrement only succeeds if enough spots remain.
        const { rows } = await c.query<{ spots_left: number; version: string; starts_at: Date }>(
          `UPDATE activities SET spots_left = spots_left - $2, version = version + 1
           WHERE id = $1 AND spots_left >= $2 AND starts_at > now()
           RETURNING spots_left, version, starts_at`,
          [activityId, requested],
        );
        if (!rows[0]) {
          const cur = await c.query<{ spots_left: number; starts_at: Date }>(
            `SELECT spots_left, starts_at FROM activities WHERE id = $1`,
            [activityId],
          );
          if (!cur.rows[0]) throw new NotFoundException('activity not found');
          if (cur.rows[0].starts_at <= new Date()) throw new BadRequestException('activity has already started');
          throw new NotEnoughSpots(cur.rows[0].spots_left, requested);
        }
        const activity = rows[0];

        const expiresAt = holdExpiresAt(activity.starts_at, new Date());
        const plan = await c.query<{ id: string }>(
          `INSERT INTO plans (activity_id, booker_id, hold_expires_at) VALUES ($1, $2, $3) RETURNING id`,
          [activityId, bookerId, expiresAt],
        );
        const planId = plan.rows[0].id;

        await c.query(
          `INSERT INTO spots (plan_id, activity_id, status, user_id) VALUES ($1, $2, 'booker', $3)`,
          [planId, activityId, bookerId],
        );
        if (heldSpots > 0) {
          await c.query(
            `INSERT INTO spots (plan_id, activity_id, status)
             SELECT $1, $2, 'held' FROM generate_series(1, $3)`,
            [planId, activityId, heldSpots],
          );
        }

        await track(c, 'booking_created', { userId: bookerId, activityId, planId }, {
          spotsHeld: heldSpots,
          holdExpiresAt: expiresAt.toISOString(),
        });

        return {
          planId,
          holdExpiresAt: expiresAt.toISOString(),
          spotsLeft: activity.spots_left,
          version: Number(activity.version),
        };
      });
    } catch (err) {
      if (err instanceof NotEnoughSpots) {
        await track(this.db.pool, 'booking_failed', { userId: bookerId, activityId }, {
          reason: 'race_lost',
          requested: err.requested,
          available: err.available,
        });
        throw new ConflictException({ reason: 'race_lost', available: err.available });
      }
      const isExpected = err instanceof HttpException || (err as { code?: string })?.code === '23505';
      if (!isExpected) {
        await track(this.db.pool, 'booking_failed', { userId: bookerId, activityId }, { reason: 'error' }).catch(
          () => undefined,
        );
      }
      throw err;
    }
  }
}
