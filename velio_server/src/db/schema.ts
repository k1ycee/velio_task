import { sql } from 'drizzle-orm';
import {
  customType,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  bigint,
} from 'drizzle-orm/pg-core';

// Typed mirror of migrations/*.sql, which stay the source of truth for the database: CHECKs, the
// partial unique indexes and the seed row live there. `test/schema-drift.e2e-spec.ts` fails if a
// column here and in the database disagree.

/** BIGINT ids as strings: ids can exceed 2^53 and the API has always returned them as strings. */
const id = customType<{ data: string; driverData: string }>({ dataType: () => 'bigint' });
const serialId = (table: string) => id('id').primaryKey().default(sql.raw(`nextval('${table}_id_seq'::regclass)`));
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const spotStatus = pgEnum('spot_status', ['booker', 'held', 'claimed', 'released']);
export const inviteType = pgEnum('invite_type', ['vouch', 'public']);

export const users = pgTable('users', {
  id: serialId('users'),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  email: text('email').notNull().unique(),
  createdAt: createdAt(),
});

export const activities = pgTable('activities', {
  id: serialId('activities'),
  hostId: id('host_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  startsAt: tstz('starts_at').notNull(),
  capacity: integer('capacity').notNull(),
  /** The oversell guard is a CHECK (0 ≤ spots_left ≤ capacity) in the migration. */
  spotsLeft: integer('spots_left').notNull(),
  /** Bumped on every count change; clients drop stale live updates. */
  version: bigint('version', { mode: 'number' }).notNull().default(0),
  createdAt: createdAt(),
});

export const plans = pgTable('plans', {
  id: serialId('plans'),
  activityId: id('activity_id')
    .notNull()
    .references(() => activities.id),
  bookerId: id('booker_id')
    .notNull()
    .references(() => users.id),
  holdExpiresAt: tstz('hold_expires_at').notNull(),
  /** Last hold warning recorded: 0, 50 or 90. */
  warnedPct: smallint('warned_pct').notNull().default(0),
  createdAt: createdAt(),
});

export const spots = pgTable('spots', {
  id: serialId('spots'),
  planId: id('plan_id')
    .notNull()
    .references(() => plans.id),
  activityId: id('activity_id')
    .notNull()
    .references(() => activities.id),
  status: spotStatus('status').notNull(),
  /** Occupant once status is booker/claimed (CHECK in the migration). */
  userId: id('user_id').references(() => users.id),
  createdAt: createdAt(),
  /** Attribution: which invite a claimed spot came through. */
  inviteId: id('invite_id'),
});

export const invites = pgTable('invites', {
  id: serialId('invites'),
  planId: id('plan_id')
    .notNull()
    .references(() => plans.id),
  type: inviteType('type').notNull(),
  token: text('token').notNull().unique(),
  /** Who the booker is vouching for. */
  label: text('label'),
  /** Vouch only: the held spot it binds. */
  spotId: id('spot_id')
    .unique()
    .references(() => spots.id),
  /** Vouch only: single-use. */
  usedAt: tstz('used_at'),
  createdAt: createdAt(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const events = pgTable('events', {
  id: serialId('events'),
  name: text('name').notNull(),
  userId: id('user_id'),
  activityId: id('activity_id'),
  planId: id('plan_id'),
  props: jsonb('props').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export type Activity = typeof activities.$inferSelect;
