import { BadRequestException, Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { activities, plans, spots, users } from '../db/schema.js';
import { UserId, requireString } from '../common/http.js';
import { toActivity } from '../activities/activities.controller.js';

// ponytail: unverified identity (verification deferred, see PLANS.md). Phone and email are each
// unique on their own, so a match on either returns the existing user.
@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  /** For the web identity picker. Names only — no contact details. */
  @Get()
  list() {
    return this.db.orm.select({ id: users.id, name: users.name }).from(users).orderBy(desc(users.id)).limit(100);
  }

  /** The guest app's "My activities" tab: every activity I hold a spot in, soonest first. */
  @Get('me/activities')
  async myActivities(@UserId() userId: string) {
    const rows = await this.db.orm
      .select({ status: spots.status, planId: spots.planId, bookerName: users.name, activity: activities })
      .from(spots)
      .innerJoin(activities, eq(activities.id, spots.activityId))
      .innerJoin(plans, eq(plans.id, spots.planId))
      .innerJoin(users, eq(users.id, plans.bookerId))
      .where(and(eq(spots.userId, userId), inArray(spots.status, ['booker', 'claimed'])))
      .orderBy(asc(activities.startsAt), asc(activities.id));
    return rows.map((r) => ({
      planId: r.planId,
      role: r.status === 'booker' ? 'booker' : 'guest',
      bookerName: r.bookerName,
      activity: toActivity(r.activity),
    }));
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const name = requireString(body, 'name');
    const phone = requireString(body, 'phone').replace(/[\s()-]/g, '');
    const email = requireString(body, 'email').toLowerCase();

    if (!/^\+?\d{6,}$/.test(phone)) throw new BadRequestException('phone must be digits, optionally starting with +');
    const [local, domain] = email.split('@');
    if (!local || !domain || email.split('@').length !== 2) throw new BadRequestException('invalid email');
    if (local.includes('+')) throw new BadRequestException('email aliases with "+" are not allowed');

    const [inserted] = await this.db.orm
      .insert(users)
      .values({ name, phone, email })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (inserted) return inserted;

    const [existing] = await this.db.orm
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.phone, phone), eq(users.email, email)))
      .orderBy(asc(users.id))
      .limit(1);
    res.status(200);
    return existing;
  }
}
