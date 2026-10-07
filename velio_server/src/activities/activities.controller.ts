import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { UserId, requireId, requireInt, requireString } from '../common/http.js';
import { track } from '../track/track.js';

interface ActivityRow {
  id: string;
  host_id: string;
  title: string;
  starts_at: Date;
  capacity: number;
  spots_left: number;
  version: string;
}

export const toActivity = (r: ActivityRow) => ({
  id: r.id,
  hostId: r.host_id,
  title: r.title,
  startsAt: r.starts_at.toISOString(),
  capacity: r.capacity,
  spotsLeft: r.spots_left,
  version: Number(r.version),
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

    return this.db.tx(async (c) => {
      const { rows } = await c.query<ActivityRow>(
        `INSERT INTO activities (host_id, title, starts_at, capacity, spots_left)
         VALUES ($1, $2, $3, $4, $4) RETURNING *`,
        [hostId, title, startsAt, capacity],
      );
      const activity = toActivity(rows[0]);
      await track(c, 'activity_created', { userId: hostId, activityId: activity.id }, {
        capacity,
        startsAt: activity.startsAt,
      });
      return activity;
    });
  }

  @Get()
  async list() {
    const { rows } = await this.db.pool.query<ActivityRow>(
      `SELECT * FROM activities WHERE starts_at > now() ORDER BY starts_at LIMIT 200`,
    );
    return rows.map(toActivity);
  }

  /** Snapshot clients fetch on connect/resume before applying SSE updates. */
  @Get(':id/availability')
  async availability(@Param('id') id: string) {
    const { rows } = await this.db.pool.query<{ spots_left: number; version: string }>(
      `SELECT spots_left, version FROM activities WHERE id = $1`,
      [requireId(id)],
    );
    if (!rows[0]) throw new NotFoundException('activity not found');
    return { spotsLeft: rows[0].spots_left, version: Number(rows[0].version) };
  }
}
