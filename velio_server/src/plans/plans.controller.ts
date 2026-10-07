import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { UserId, requireId } from '../common/http.js';
import { toActivity } from '../activities/activities.controller.js';

const ACTIVITY_COLUMNS = `a.id, a.host_id, a.title, a.starts_at, a.capacity, a.spots_left, a.version`;

@Controller('plans')
export class PlansController {
  constructor(private readonly db: DbService) {}

  @Get()
  async mine(@UserId() userId: string) {
    const { rows } = await this.db.pool.query(
      `SELECT p.id AS plan_id, p.hold_expires_at, ${ACTIVITY_COLUMNS}
       FROM plans p JOIN activities a ON a.id = p.activity_id
       WHERE p.booker_id = $1 ORDER BY p.id DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.plan_id,
      holdExpiresAt: r.hold_expires_at.toISOString(),
      activity: toActivity(r),
    }));
  }

  /** Everything the booker's plan page shows: activity, hold countdown, members, invites. */
  @Get(':id')
  async get(@UserId() userId: string, @Param('id') id: string) {
    const planId = requireId(id);
    const plan = await this.db.pool.query(
      `SELECT p.booker_id, p.created_at, p.hold_expires_at, p.warned_pct, ${ACTIVITY_COLUMNS}
       FROM plans p JOIN activities a ON a.id = p.activity_id WHERE p.id = $1`,
      [planId],
    );
    const p = plan.rows[0];
    if (!p) throw new NotFoundException('plan not found');
    if (p.booker_id !== userId) throw new ForbiddenException('only the booker can view this plan');

    const [spots, invites] = await Promise.all([
      this.db.pool.query(
        `SELECT s.status, s.user_id, u.name, i.type AS invite_type
         FROM spots s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN invites i ON i.id = s.invite_id
         WHERE s.plan_id = $1 ORDER BY s.id`,
        [planId],
      ),
      this.db.pool.query(
        `SELECT id, type, token, label, used_at FROM invites WHERE plan_id = $1 ORDER BY id`,
        [planId],
      ),
    ]);

    return {
      id: planId,
      bookerId: p.booker_id,
      activity: toActivity(p),
      holdStartedAt: p.created_at.toISOString(),
      holdExpiresAt: p.hold_expires_at.toISOString(),
      warnedPct: p.warned_pct,
      heldSpotsLeft: spots.rows.filter((s) => s.status === 'held').length,
      members: spots.rows
        .filter((s) => s.status === 'booker' || s.status === 'claimed')
        .map((s) => ({
          userId: s.user_id,
          name: s.name,
          role: s.status === 'booker' ? 'booker' : 'guest',
          inviteType: s.invite_type ?? null,
        })),
      invites: invites.rows.map((i) => ({
        inviteId: i.id,
        type: i.type,
        token: i.token,
        label: i.label,
        used: i.used_at !== null,
        url: `velio://invite/${i.token}`,
      })),
    };
  }
}
