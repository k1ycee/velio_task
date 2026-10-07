import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { DbService } from '../db/db.service.js';
import { track } from '../track/track.js';

export type InviteType = 'vouch' | 'public';

interface InviteRow {
  id: string;
  plan_id: string;
  type: InviteType;
  token: string;
  label: string | null;
  spot_id: string | null;
  used_at: Date | null;
}

const toInvite = (r: InviteRow) => ({
  inviteId: r.id,
  type: r.type,
  token: r.token,
  label: r.label,
  url: `velio://invite/${r.token}`,
});

// A held spot no vouch URL has claimed for itself. Public claims may take these.
const UNBOUND_HELD_SPOT = `
  SELECT s.id FROM spots s
  WHERE s.plan_id = $1 AND s.status = 'held'
    AND NOT EXISTS (SELECT 1 FROM invites i WHERE i.spot_id = s.id)
  ORDER BY s.id LIMIT 1
  FOR UPDATE SKIP LOCKED`;

class NoSpotLeft {}

@Injectable()
export class InvitesService {
  constructor(private readonly db: DbService) {}

  /** Vouch: binds one unbound held spot (201). Public: one reusable URL per plan (201 new, 200 existing). */
  async create(userId: string, planId: string, type: InviteType, label: string | null) {
    return this.db.tx(async (c) => {
      const plan = await c.query<{ booker_id: string; activity_id: string }>(
        `SELECT booker_id, activity_id FROM plans WHERE id = $1 FOR UPDATE`,
        [planId],
      );
      if (!plan.rows[0]) throw new NotFoundException('plan not found');
      if (plan.rows[0].booker_id !== userId) throw new ForbiddenException('only the booker can invite');
      const ids = { userId, activityId: plan.rows[0].activity_id, planId };

      if (type === 'public') {
        const existing = await c.query<InviteRow>(`SELECT * FROM invites WHERE plan_id = $1 AND type = 'public'`, [
          planId,
        ]);
        if (existing.rows[0]) return { created: false, invite: toInvite(existing.rows[0]) };
      }

      let spotId: string | null = null;
      if (type === 'vouch') {
        const spot = await c.query<{ id: string }>(UNBOUND_HELD_SPOT, [planId]);
        if (!spot.rows[0]) throw new ConflictException({ reason: 'no_held_spot', message: 'no unbound held spot left' });
        spotId = spot.rows[0].id;
      }

      const { rows } = await c.query<InviteRow>(
        `INSERT INTO invites (plan_id, type, token, label, spot_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [planId, type, randomBytes(16).toString('base64url'), label, spotId],
      );
      await track(c, 'invite_created', ids, { inviteType: type, inviteId: rows[0].id });
      return { created: true, invite: toInvite(rows[0]) };
    });
  }

  /** What the guest sees on opening the link. Tracks invite_opened when we know who's looking. */
  async open(token: string, viewerId: string | null) {
    const { rows } = await this.db.pool.query(
      `SELECT i.id, i.type, i.label, i.used_at, i.plan_id, u.name AS inviter_name,
              a.id AS activity_id, a.title, a.starts_at, a.capacity, a.spots_left, a.version
       FROM invites i
       JOIN plans p ON p.id = i.plan_id
       JOIN users u ON u.id = p.booker_id
       JOIN activities a ON a.id = p.activity_id
       WHERE i.token = $1`,
      [token],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('invite not found');
    await track(this.db.pool, 'invite_opened', { userId: viewerId, activityId: r.activity_id, planId: r.plan_id }, {
      inviteType: r.type,
      inviteId: r.id,
    });
    return {
      inviteId: r.id,
      type: r.type as InviteType,
      label: r.label as string | null,
      used: r.used_at !== null,
      planId: r.plan_id,
      inviterName: r.inviter_name,
      activity: {
        id: r.activity_id,
        title: r.title,
        startsAt: (r.starts_at as Date).toISOString(),
        capacity: r.capacity,
        spotsLeft: r.spots_left,
        version: Number(r.version),
      },
    };
  }

  async claim(userId: string, token: string) {
    try {
      return await this.db.tx(async (c) => {
        const { rows } = await c.query<
          InviteRow & { activity_id: string; booker_id: string; starts_at: Date }
        >(
          `SELECT i.*, p.activity_id, p.booker_id, a.starts_at
           FROM invites i
           JOIN plans p ON p.id = i.plan_id
           JOIN activities a ON a.id = p.activity_id
           WHERE i.token = $1
           FOR UPDATE OF i`,
          [token],
        );
        const inv = rows[0];
        if (!inv) throw new NotFoundException('invite not found');
        if (inv.booker_id === userId) throw new BadRequestException('you cannot claim your own invite');
        if (inv.starts_at <= new Date()) throw new BadRequestException('activity has already started');
        if (inv.type === 'vouch' && inv.used_at) throw new ConflictException({ reason: 'used' });

        const isNewUser = await this.isNewUser(c, userId);
        let spotId: string | null = null;

        if (inv.type === 'vouch') {
          // ponytail: a held spot whose window passed but the expiry job hasn't released yet is still
          // claimable — same count outcome as release + reclaim, in one step.
          const bound = await c.query<{ id: string }>(
            `SELECT id FROM spots WHERE id = $1 AND status = 'held' FOR UPDATE`,
            [inv.spot_id],
          );
          spotId = bound.rows[0]?.id ?? null;
        } else {
          const unbound = await c.query<{ id: string }>(UNBOUND_HELD_SPOT, [inv.plan_id]);
          spotId = unbound.rows[0]?.id ?? null;
        }

        let source: 'held' | 'open';
        let counts: { spots_left: number; version: string };
        if (spotId) {
          source = 'held';
          await c.query(`UPDATE spots SET status = 'claimed', user_id = $2, invite_id = $3 WHERE id = $1`, [
            spotId,
            userId,
            inv.id,
          ]);
          counts = (await c.query(`SELECT spots_left, version FROM activities WHERE id = $1`, [inv.activity_id]))
            .rows[0];
        } else {
          // Public overflow, or a vouch whose held spot was released: take an open spot.
          source = 'open';
          const dec = await c.query<{ spots_left: number; version: string }>(
            `UPDATE activities SET spots_left = spots_left - 1, version = version + 1
             WHERE id = $1 AND spots_left >= 1 RETURNING spots_left, version`,
            [inv.activity_id],
          );
          if (!dec.rows[0]) throw new NoSpotLeft();
          counts = dec.rows[0];
          const spot = await c.query<{ id: string }>(
            `INSERT INTO spots (plan_id, activity_id, status, user_id, invite_id)
             VALUES ($1, $2, 'claimed', $3, $4) RETURNING id`,
            [inv.plan_id, inv.activity_id, userId, inv.id],
          );
          spotId = spot.rows[0].id;
        }

        if (inv.type === 'vouch') await c.query(`UPDATE invites SET used_at = now() WHERE id = $1`, [inv.id]);

        await track(c, 'spot_claimed', { userId, activityId: inv.activity_id, planId: inv.plan_id }, {
          inviteType: inv.type,
          inviteId: inv.id,
          inviterId: inv.booker_id,
          isNewUser,
          source,
        });

        return {
          spotId,
          planId: inv.plan_id,
          activityId: inv.activity_id,
          source,
          spotsLeft: counts.spots_left,
          version: Number(counts.version),
        };
      });
    } catch (err) {
      if (err instanceof NoSpotLeft) {
        await this.trackFailure(userId, token, 'race_lost');
        throw new ConflictException({ reason: 'race_lost', message: 'that spot was just taken' });
      }
      const isExpected = err instanceof HttpException || (err as { code?: string })?.code === '23505';
      if (!isExpected) await this.trackFailure(userId, token, 'error').catch(() => undefined);
      throw err;
    }
  }

  /** "New user" = their first action on Velio is this claim: no spots held and nothing hosted before. */
  private async isNewUser(c: pg.PoolClient, userId: string) {
    const { rows } = await c.query<{ is_new: boolean }>(
      `SELECT NOT EXISTS (SELECT 1 FROM spots WHERE user_id = $1)
          AND NOT EXISTS (SELECT 1 FROM activities WHERE host_id = $1) AS is_new`,
      [userId],
    );
    return rows[0].is_new;
  }

  private async trackFailure(userId: string, token: string, reason: 'race_lost' | 'error') {
    const { rows } = await this.db.pool.query(
      `SELECT i.id, i.type, i.plan_id, p.activity_id FROM invites i JOIN plans p ON p.id = i.plan_id WHERE i.token = $1`,
      [token],
    );
    const r = rows[0];
    await track(this.db.pool, 'booking_failed', { userId, activityId: r?.activity_id, planId: r?.plan_id }, {
      reason,
      via: 'claim',
      inviteType: r?.type,
      inviteId: r?.id,
    });
  }
}
