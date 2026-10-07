import pg from 'pg';

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
export async function computeMetrics(db: pg.Pool | pg.PoolClient, since = new Date(0)): Promise<Metrics> {
  const [integrity, events, opens, plans] = await Promise.all([
    db.query(
      `SELECT count(*) FILTER (WHERE taken > capacity)::int AS oversold,
              count(*) FILTER (WHERE capacity - spots_left <> taken)::int AS drift
       FROM (
         SELECT a.capacity, a.spots_left,
                (SELECT count(*) FROM spots s WHERE s.activity_id = a.id AND s.status <> 'released') AS taken
         FROM activities a WHERE a.created_at >= $1
       ) t`,
      [since],
    ),
    db.query(
      `SELECT
         count(*) FILTER (WHERE name IN ('booking_created', 'spot_claimed'))::int AS successes,
         count(*) FILTER (WHERE name = 'booking_failed' AND props->>'reason' IN ('error', 'timeout'))::int AS failures,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY (props->>'latencyMs')::numeric)
           FILTER (WHERE name = 'availability_received') AS p95,
         count(*) FILTER (WHERE name = 'availability_received')::int AS samples,
         count(DISTINCT user_id) FILTER (WHERE name = 'booking_created')::int AS bookers,
         count(DISTINCT user_id) FILTER (WHERE name = 'invite_created')::int AS inviters,
         count(*) FILTER (WHERE name = 'spot_claimed' AND props->>'inviteType' = 'vouch')::int AS vouch_claims,
         count(*) FILTER (WHERE name = 'spot_claimed' AND props->>'inviteType' = 'public')::int AS public_claims,
         count(*) FILTER (WHERE name = 'spot_claimed' AND props->>'inviteType' = 'vouch'
                          AND (props->>'isNewUser')::boolean)::int AS vouch_new,
         count(*) FILTER (WHERE name = 'spot_claimed' AND props->>'inviteType' = 'public'
                          AND (props->>'isNewUser')::boolean)::int AS public_new
       FROM events WHERE created_at >= $1`,
      [since],
    ),
    // An open counts once per person per link; anonymous opens count individually.
    db.query(
      `SELECT props->>'inviteType' AS type,
              count(DISTINCT coalesce(user_id::text, 'anon:' || id) || ':' || (props->>'inviteId'))::int AS n
       FROM events WHERE name = 'invite_opened' AND created_at >= $1
       GROUP BY 1`,
      [since],
    ),
    db.query(
      `SELECT count(*)::int AS past,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM spots s WHERE s.plan_id = p.id AND s.status = 'claimed'
              ))::int AS happened
       FROM plans p JOIN activities a ON a.id = p.activity_id
       WHERE a.starts_at < now() AND p.created_at >= $1`,
      [since],
    ),
  ]);

  const i = integrity.rows[0];
  const e = events.rows[0];
  const openCount = (type: string) => opens.rows.find((r) => r.type === type)?.n ?? 0;
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
    claimRatePct: { vouch: pct(e.vouch_claims, openCount('vouch')), public: pct(e.public_claims, openCount('public')) },
    kFactor: {
      total: ratio(e.vouch_new + e.public_new, e.bookers),
      vouch: ratio(e.vouch_new, e.bookers),
      public: ratio(e.public_new, e.bookers),
    },
    plansHappened: plans.rows[0].happened,
    pastPlans: plans.rows[0].past,
  };
}
