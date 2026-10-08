import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { asc, eq, gt, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { activities, type Activity } from '../db/schema.js';
import { UserId, requireId, requireInt, requireString } from '../common/http.js';
import { track } from '../track/track.js';

export const toActivity = (a: Activity) => ({
  id: a.id,
  hostId: a.hostId,
  title: a.title,
  startsAt: a.startsAt.toISOString(),
  capacity: a.capacity,
  spotsLeft: a.spotsLeft,
  version: a.version,
});

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly db: DbService) {}

  @Post()
  async create(@UserId() hostId: string, @Body() body: Record<string, unknown>) {
    const title = requireString(body, 'title');
    const startsAt = new Date(requireString(body, 'startsAt'));
    const capacity = requireInt(body, 'capacity', 1);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
      throw new BadRequestException('startsAt must be a future ISO date');
    }

    return this.db.tx(async (tx) => {
      const [row] = await tx
        .insert(activities)
        .values({ hostId, title, startsAt, capacity, spotsLeft: capacity })
        .returning();
      const activity = toActivity(row);
      await track(tx, 'activity_created', { userId: hostId, activityId: activity.id }, {
        capacity,
        startsAt: activity.startsAt,
      });
      return activity;
    });
  }

  @Get()
  async list() {
    const rows = await this.db.orm
      .select()
      .from(activities)
      .where(gt(activities.startsAt, sql`now()`))
      .orderBy(asc(activities.startsAt))
      .limit(200);
    return rows.map(toActivity);
  }

  /** Snapshot clients fetch on connect/resume before applying SSE updates. */
  @Get(':id/availability')
  async availability(@Param('id') id: string) {
    const [row] = await this.db.orm
      .select({ spotsLeft: activities.spotsLeft, version: activities.version })
      .from(activities)
      .where(eq(activities.id, requireId(id)));
    if (!row) throw new NotFoundException('activity not found');
    return row;
  }
}
