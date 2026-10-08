import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { activities, invites, plans, spots, users } from '../db/schema.js';
import { UserId, requireId } from '../common/http.js';
import { toActivity } from '../activities/activities.controller.js';

@Controller('plans')
export class PlansController {
  constructor(private readonly db: DbService) {}

  @Get()
  async mine(@UserId() userId: string) {
    const rows = await this.db.orm
      .select({ id: plans.id, holdExpiresAt: plans.holdExpiresAt, activity: activities })
      .from(plans)
      .innerJoin(activities, eq(activities.id, plans.activityId))
      .where(eq(plans.bookerId, userId))
      .orderBy(desc(plans.id));
    return rows.map((r) => ({ id: r.id, holdExpiresAt: r.holdExpiresAt.toISOString(), activity: toActivity(r.activity) }));
  }

  /** Everything the booker's plan page shows: activity, hold countdown, members, invites. */
  @Get(':id')
  async get(@UserId() userId: string, @Param('id') id: string) {
    const planId = requireId(id);
    const [p] = await this.db.orm
      .select({ plan: plans, activity: activities })
      .from(plans)
      .innerJoin(activities, eq(activities.id, plans.activityId))
      .where(eq(plans.id, planId));
    if (!p) throw new NotFoundException('plan not found');
    if (p.plan.bookerId !== userId) throw new ForbiddenException('only the booker can view this plan');

    const [planSpots, planInvites] = await Promise.all([
      this.db.orm
        .select({ status: spots.status, userId: spots.userId, name: users.name, inviteType: invites.type })
        .from(spots)
        .leftJoin(users, eq(users.id, spots.userId))
        .leftJoin(invites, eq(invites.id, spots.inviteId))
        .where(eq(spots.planId, planId))
        .orderBy(asc(spots.id)),
      this.db.orm.select().from(invites).where(eq(invites.planId, planId)).orderBy(asc(invites.id)),
    ]);

    return {
      id: planId,
      bookerId: p.plan.bookerId,
      activity: toActivity(p.activity),
      holdStartedAt: p.plan.createdAt.toISOString(),
      holdExpiresAt: p.plan.holdExpiresAt.toISOString(),
      warnedPct: p.plan.warnedPct,
      heldSpotsLeft: planSpots.filter((s) => s.status === 'held').length,
      members: planSpots
        .filter((s) => s.status === 'booker' || s.status === 'claimed')
        .map((s) => ({
          userId: s.userId,
          name: s.name,
          role: s.status === 'booker' ? 'booker' : 'guest',
          inviteType: s.inviteType ?? null,
        })),
      invites: planInvites.map((i) => ({
        inviteId: i.id,
        type: i.type,
        token: i.token,
        label: i.label,
        used: i.usedAt !== null,
        url: `velio://invite/${i.token}`,
      })),
    };
  }
}
