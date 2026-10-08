import { and, count, eq, exists, gte, lt, ne, sql } from 'drizzle-orm';
import type { Executor } from '../db/db.service.js';
import { activities, events, plans, spots } from '../db/schema.js';

type ByType = { vouch: number | null; public: number | null };

export interface Metrics {
  /** Activities with more non-released spots than capacity. Target: 0, ever. */
  oversoldActivities: number;
  /** Activities whose spots_left disagrees with their spot rows. Should also be 0. */
  countDrift: number;
  bookingAttempts: number;
  bookingFailures: number;
  /** Successes ÷ attempts on available spots (race_lost excluded). Target: 99.5%. */
  bookingSuccessPct: number | null;
  /** Commit → client receipt. Target: ≤ 2000ms. */
  latencyP95Ms: number | null;
  latencySamples: number;
  bookers: number;
  inviters: number;
  /** Bookers who created ≥1 vouch or public link. Target: 30%. */
  inviteRatePct: number | null;
  /** Claims ÷ unique opens (per person per link). Target: 25%. */
  claimRatePct: ByType;
  /** New users whose first action was an invite claim ÷ bookers. */
  kFactor: ByType & { total: number | null };
  /** Past plans where the booker and ≥1 invited guest still held spots. */
  plansHappened: number;
  pastPlans: number;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const pct = (num: number, den: number) => (den > 0 ? round((num * 100) / den, 1) : null);
const ratio = (num: number, den: number) => (den > 0 ? round(num / den, 2) : null);

// ponytail: all-time by default with a `since` cut-off; add date-range windows when someone needs trends.
export async function computeMetrics(db: Executor, since = new Date(0)): Promise<Metrics> {
  const int = (q: ReturnType<typeof sql>) => q.mapWith(Number);
  const evt = (name: string) => sql`${events.name} = ${name}`;
  // JSON keys are code constants, inlined as literals so a SELECT and its GROUP BY are the same
  // expression (as bind parameters, $1 and $5 would not match).
  const prop = (key: 'reason' | 'latencyMs' | 'inviteType' | 'isNewUser' | 'inviteId') =>
    sql`${events.props}->>${sql.raw(`'${key}'`)}`;

  // Per activity: how many spots are taken according to the spot rows.
  const taken = db
    .select({
      capacity: activities.capacity,
      spotsLeft: activities.spotsLeft,
      // A nested builder, not a sql`` string: Drizzle drops table names from columns in a select
      // list, which would turn a hand-written correlated subquery into spots.activity_id = spots.id.
      taken: sql<number>`(${db
        .select({ n: count() })
        .from(spots)
        .where(and(eq(spots.activityId, activities.id), ne(spots.status, 'released')))})`.as('taken'),
    })
    .from(activities)
    .where(gte(activities.createdAt, since))
    .as('t');

  const [integrity, eventRows, opens, planRows] = await Promise.all([
    db
      .select({
        oversold: int(sql`count(*) FILTER (WHERE ${taken.taken} > ${taken.capacity})`),
        drift: int(sql`count(*) FILTER (WHERE ${taken.capacity} - ${taken.spotsLeft} <> ${taken.taken})`),
      })
      .from(taken),
    db
      .select({
        successes: int(sql`count(*) FILTER (WHERE ${events.name} IN ('booking_created', 'spot_claimed'))`),
        failures: int(sql`count(*) FILTER (WHERE ${evt('booking_failed')} AND ${prop('reason')} IN ('error', 'timeout'))`),
        p95: sql<string | null>`percentile_cont(0.95) WITHIN GROUP (ORDER BY (${prop('latencyMs')})::numeric)
                                FILTER (WHERE ${evt('availability_received')})`,
        samples: int(sql`count(*) FILTER (WHERE ${evt('availability_received')})`),
        bookers: int(sql`count(DISTINCT ${events.userId}) FILTER (WHERE ${evt('booking_created')})`),
        inviters: int(sql`count(DISTINCT ${events.userId}) FILTER (WHERE ${evt('invite_created')})`),
        vouchClaims: int(sql`count(*) FILTER (WHERE ${evt('spot_claimed')} AND ${prop('inviteType')} = 'vouch')`),
        publicClaims: int(sql`count(*) FILTER (WHERE ${evt('spot_claimed')} AND ${prop('inviteType')} = 'public')`),
        vouchNew: int(sql`count(*) FILTER (WHERE ${evt('spot_claimed')} AND ${prop('inviteType')} = 'vouch'
                                           AND (${prop('isNewUser')})::boolean)`),
        publicNew: int(sql`count(*) FILTER (WHERE ${evt('spot_claimed')} AND ${prop('inviteType')} = 'public'
                                            AND (${prop('isNewUser')})::boolean)`),
      })
      .from(events)
      .where(gte(events.createdAt, since)),
    // An open counts once per person per link; anonymous opens count individually.
    db
      .select({
        type: sql<string>`${prop('inviteType')}`,
        n: int(sql`count(DISTINCT coalesce(${events.userId}::text, 'anon:' || ${events.id}) || ':' || (${prop('inviteId')}))`),
      })
      .from(events)
      .where(and(eq(events.name, 'invite_opened'), gte(events.createdAt, since)))
      .groupBy(prop('inviteType')),
    db
      .select({
        past: count(),
        happened: int(sql`count(*) FILTER (WHERE ${exists(
          db.select({ one: sql`1` }).from(spots).where(and(eq(spots.planId, plans.id), eq(spots.status, 'claimed'))),
        )})`),
      })
      .from(plans)
      .innerJoin(activities, eq(activities.id, plans.activityId))
      .where(and(lt(activities.startsAt, sql`now()`), gte(plans.createdAt, since))),
  ]);

  const i = integrity[0];
  const e = eventRows[0];
  const openCount = (type: string) => opens.find((r) => r.type === type)?.n ?? 0;
  const attempts = e.successes + e.failures;

  return {
    oversoldActivities: i.oversold,
    countDrift: i.drift,
    bookingAttempts: attempts,
    bookingFailures: e.failures,
    bookingSuccessPct: pct(e.successes, attempts),
    latencyP95Ms: e.p95 === null ? null : Math.round(Number(e.p95)),
    latencySamples: e.samples,
    bookers: e.bookers,
    inviters: e.inviters,
    inviteRatePct: pct(e.inviters, e.bookers),
    claimRatePct: { vouch: pct(e.vouchClaims, openCount('vouch')), public: pct(e.publicClaims, openCount('public')) },
    kFactor: {
      total: ratio(e.vouchNew + e.publicNew, e.bookers),
      vouch: ratio(e.vouchNew, e.bookers),
      public: ratio(e.publicNew, e.bookers),
    },
    plansHappened: planRows[0].happened,
    pastPlans: planRows[0].past,
  };
}
