import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, notExists, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { pgCode } from '../common/http.js';
import { DbService, type Tx } from '../db/db.service.js';
import { activities, invites, plans, spots, users } from '../db/schema.js';
import { LiveService } from '../live/live.service.js';
import { track } from '../track/track.js';

export type InviteType = 'vouch' | 'public';

const toInvite = (i: typeof invites.$inferSelect) => ({
  inviteId: i.id,
  type: i.type,
  token: i.token,
  label: i.label,
  url: `velio://invite/${i.token}`,
});

/** A held spot no vouch URL has claimed for itself, locked for this transaction. Public claims may take these. */
async function unboundHeldSpot(tx: Tx, planId: string) {
  const [spot] = await tx
    .select({ id: spots.id })
    .from(spots)
    .where(
      and(
        eq(spots.planId, planId),
        eq(spots.status, 'held'),
        notExists(tx.select({ one: sql`1` }).from(invites).where(eq(invites.spotId, spots.id))),
      ),
    )
    .orderBy(asc(spots.id))
    .limit(1)
    .for('update', { skipLocked: true });
  return spot?.id ?? null;
}

class NoSpotLeft {}

@Injectable()
export class InvitesService {
  constructor(
    private readonly db: DbService,
    private readonly live: LiveService,
  ) {}

  /** Vouch: binds one unbound held spot (201). Public: one reusable URL per plan (201 new, 200 existing). */
  async create(userId: string, planId: string, type: InviteType, label: string | null) {
    return this.db.tx(async (tx) => {
      const [plan] = await tx
        .select({ bookerId: plans.bookerId, activityId: plans.activityId })
        .from(plans)
        .where(eq(plans.id, planId))
        .for('update');
      if (!plan) throw new NotFoundException('plan not found');
      if (plan.bookerId !== userId) throw new ForbiddenException('only the booker can invite');
      const ids = { userId, activityId: plan.activityId, planId };

      if (type === 'public') {
        const [existing] = await tx
          .select()
          .from(invites)
          .where(and(eq(invites.planId, planId), eq(invites.type, 'public')));
        if (existing) return { created: false, invite: toInvite(existing) };
      }

      let spotId: string | null = null;
      if (type === 'vouch') {
        spotId = await unboundHeldSpot(tx, planId);
        if (!spotId) throw new ConflictException({ reason: 'no_held_spot', message: 'no unbound held spot left' });
      }

      const [invite] = await tx
        .insert(invites)
        .values({ planId, type, token: randomBytes(16).toString('base64url'), label, spotId })
        .returning();
      await track(tx, 'invite_created', ids, { inviteType: type, inviteId: invite.id });
      return { created: true, invite: toInvite(invite) };
    });
  }

  /** What the guest sees on opening the link. Tracks invite_opened when we know who's looking. */
  async open(token: string, viewerId: string | null) {
    const [r] = await this.db.orm
      .select({ invite: invites, inviterName: users.name, activity: activities })
      .from(invites)
      .innerJoin(plans, eq(plans.id, invites.planId))
      .innerJoin(users, eq(users.id, plans.bookerId))
      .innerJoin(activities, eq(activities.id, plans.activityId))
      .where(eq(invites.token, token));
    if (!r) throw new NotFoundException('invite not found');
    const { invite, activity } = r;
    await track(this.db.orm, 'invite_opened', { userId: viewerId, activityId: activity.id, planId: invite.planId }, {
      inviteType: invite.type,
      inviteId: invite.id,
    });
    return {
      inviteId: invite.id,
      type: invite.type,
      label: invite.label,
      used: invite.usedAt !== null,
      planId: invite.planId,
      inviterName: r.inviterName,
      activity: {
        id: activity.id,
        title: activity.title,
        startsAt: activity.startsAt.toISOString(),
        capacity: activity.capacity,
        spotsLeft: activity.spotsLeft,
        version: activity.version,
      },
    };
  }

  async claim(userId: string, token: string) {
    try {
      const result = await this.db.tx(async (tx) => {
        const [row] = await tx
          .select({
            invite: invites,
            activityId: plans.activityId,
            bookerId: plans.bookerId,
            startsAt: activities.startsAt,
          })
          .from(invites)
          .innerJoin(plans, eq(plans.id, invites.planId))
          .innerJoin(activities, eq(activities.id, plans.activityId))
          .where(eq(invites.token, token))
          .for('update', { of: invites });
        if (!row) throw new NotFoundException('invite not found');
        const { invite: inv, activityId, bookerId } = row;
        if (bookerId === userId) throw new BadRequestException('you cannot claim your own invite');
        if (row.startsAt <= new Date()) throw new BadRequestException('activity has already started');
        if (inv.type === 'vouch' && inv.usedAt) throw new ConflictException({ reason: 'used' });

        const isNewUser = await this.isNewUser(tx, userId);
        let spotId: string | null = null;

        if (inv.type === 'vouch' && inv.spotId) {
          // ponytail: a held spot whose window passed but the expiry job hasn't released yet is still
          // claimable — same count outcome as release + reclaim, in one step.
          const [bound] = await tx
            .select({ id: spots.id })
            .from(spots)
            .where(and(eq(spots.id, inv.spotId), eq(spots.status, 'held')))
            .for('update');
          spotId = bound?.id ?? null;
        } else if (inv.type === 'public') {
          spotId = await unboundHeldSpot(tx, inv.planId);
        }

        let source: 'held' | 'open';
        let counts: { spotsLeft: number; version: number };
        if (spotId) {
          source = 'held';
          await tx.update(spots).set({ status: 'claimed', userId, inviteId: inv.id }).where(eq(spots.id, spotId));
          [counts] = await tx
            .select({ spotsLeft: activities.spotsLeft, version: activities.version })
            .from(activities)
            .where(eq(activities.id, activityId));
        } else {
          // Public overflow, or a vouch whose held spot was released: take an open spot.
          source = 'open';
          const [dec] = await tx
            .update(activities)
            .set({ spotsLeft: sql`${activities.spotsLeft} - 1`, version: sql`${activities.version} + 1` })
            .where(and(eq(activities.id, activityId), gte(activities.spotsLeft, 1)))
            .returning({ spotsLeft: activities.spotsLeft, version: activities.version });
          if (!dec) throw new NoSpotLeft();
          counts = dec;
          const [spot] = await tx
            .insert(spots)
            .values({ planId: inv.planId, activityId, status: 'claimed', userId, inviteId: inv.id })
            .returning({ id: spots.id });
          spotId = spot.id;
        }

        if (inv.type === 'vouch') await tx.update(invites).set({ usedAt: sql`now()` }).where(eq(invites.id, inv.id));

        await track(tx, 'spot_claimed', { userId, activityId, planId: inv.planId }, {
          inviteType: inv.type,
          inviteId: inv.id,
          inviterId: bookerId,
          isNewUser,
          source,
        });

        return { spotId, planId: inv.planId, activityId, source, spotsLeft: counts.spotsLeft, version: counts.version };
      });
      // Claiming a held spot doesn't change the count; only open-pool claims do.
      if (result.source === 'open') await this.live.publish(result.activityId, result.spotsLeft, result.version);
      return result;
    } catch (err) {
      if (err instanceof NoSpotLeft) {
        await this.trackFailure(userId, token, 'race_lost');
        throw new ConflictException({ reason: 'race_lost', message: 'that spot was just taken' });
      }
      const isExpected = err instanceof HttpException || pgCode(err) === '23505';
      if (!isExpected) await this.trackFailure(userId, token, 'error').catch(() => undefined);
      throw err;
    }
  }

  /** "New user" = their first action on Velio is this claim: no spots held and nothing hosted before. */
  private async isNewUser(tx: Tx, userId: string) {
    const [spot] = await tx.select({ id: spots.id }).from(spots).where(eq(spots.userId, userId)).limit(1);
    if (spot) return false;
    const [hosted] = await tx.select({ id: activities.id }).from(activities).where(eq(activities.hostId, userId)).limit(1);
    return !hosted;
  }

  private async trackFailure(userId: string, token: string, reason: 'race_lost' | 'error') {
    const [r] = await this.db.orm
      .select({ id: invites.id, type: invites.type, planId: invites.planId, activityId: plans.activityId })
      .from(invites)
      .innerJoin(plans, eq(plans.id, invites.planId))
      .where(eq(invites.token, token));
    await track(this.db.orm, 'booking_failed', { userId, activityId: r?.activityId, planId: r?.planId }, {
      reason,
      via: 'claim',
      inviteType: r?.type,
      inviteId: r?.id,
    });
  }
}
