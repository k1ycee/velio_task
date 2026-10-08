import { BadRequestException, Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../db/db.service.js';
import { UserId, requireString } from '../common/http.js';
import { toActivity } from '../activities/activities.controller.js';

// ponytail: unverified identity (verification deferred, see PLANS.md). Phone and email are each
// unique on their own, so a match on either returns the existing user.
@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  /** For the web identity picker. Names only — no contact details. */
  @Get()
  async list() {
    const { rows } = await this.db.pool.query(`SELECT id, name FROM users ORDER BY id DESC LIMIT 100`);
    return rows;
  }

  /** The guest app's "My activities" tab: every activity I hold a spot in, soonest first. */
  @Get('me/activities')
  async myActivities(@UserId() userId: string) {
    const { rows } = await this.db.pool.query(
      `SELECT s.status, s.plan_id, b.name AS booker_name,
              a.id, a.host_id, a.title, a.starts_at, a.capacity, a.spots_left, a.version
       FROM spots s
       JOIN activities a ON a.id = s.activity_id
       JOIN plans p ON p.id = s.plan_id
       JOIN users b ON b.id = p.booker_id
       WHERE s.user_id = $1 AND s.status IN ('booker', 'claimed')
       ORDER BY a.starts_at, a.id`,
      [userId],
    );
    return rows.map((r) => ({
      planId: r.plan_id,
      role: r.status === 'booker' ? 'booker' : 'guest',
      bookerName: r.booker_name,
      activity: toActivity(r),
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

    const inserted = await this.db.pool.query<{ id: string }>(
      `INSERT INTO users (name, phone, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
      [name, phone, email],
    );
    if (inserted.rows[0]) return { id: inserted.rows[0].id };

    const existing = await this.db.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE phone = $1 OR email = $2 ORDER BY id LIMIT 1`,
      [phone, email],
    );
    res.status(200);
    return { id: existing.rows[0].id };
  }
}
