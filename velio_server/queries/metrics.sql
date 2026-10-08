-- Velio metrics, runnable in psql. Same definitions as src/dashboard/metrics.ts (GET /dashboard).
--   docker compose exec -T postgres psql -U velio -d velio < velio_server/queries/metrics.sql
-- Change :since to look at a window, e.g.  psql ... -v since="'2026-10-08'"
\if :{?since} \else \set since '''1970-01-01''' \endif

\echo '== 1. Never oversell (target: 0 oversold, 0 drift)'
SELECT count(*) FILTER (WHERE taken > capacity)           AS oversold_activities,
       count(*) FILTER (WHERE capacity - spots_left <> taken) AS count_drift
FROM (
  SELECT a.capacity, a.spots_left,
         (SELECT count(*) FROM spots s WHERE s.activity_id = a.id AND s.status <> 'released') AS taken
  FROM activities a WHERE a.created_at >= :since
) t;

\echo '== 2. Booking success on available spots (target: >= 99.5%; race_lost excluded)'
SELECT successes, failures,
       round(100.0 * successes / nullif(successes + failures, 0), 1) AS success_pct
FROM (
  SELECT count(*) FILTER (WHERE name IN ('booking_created', 'spot_claimed')) AS successes,
         count(*) FILTER (WHERE name = 'booking_failed' AND props->>'reason' IN ('error', 'timeout')) AS failures
  FROM events WHERE created_at >= :since
) t;

\echo '== 2b. Failures by reason (race_lost = no spot at commit; not counted against 99.5%)'
SELECT props->>'reason' AS reason, props->>'via' AS via, count(*)
FROM events WHERE name = 'booking_failed' AND created_at >= :since
GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== 3. Availability latency, commit -> client (target: p95 <= 2000 ms)'
SELECT count(*) AS samples,
       round(percentile_cont(0.50) WITHIN GROUP (ORDER BY (props->>'latencyMs')::numeric)) AS p50_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (props->>'latencyMs')::numeric)) AS p95_ms,
       max((props->>'latencyMs')::numeric) AS max_ms
FROM events WHERE name = 'availability_received' AND created_at >= :since;

\echo '== 4. Bookers who invite (target: >= 30%)'
SELECT count(DISTINCT user_id) FILTER (WHERE name = 'booking_created') AS bookers,
       count(DISTINCT user_id) FILTER (WHERE name = 'invite_created')  AS inviters,
       round(100.0 * count(DISTINCT user_id) FILTER (WHERE name = 'invite_created')
             / nullif(count(DISTINCT user_id) FILTER (WHERE name = 'booking_created'), 0), 1) AS invite_rate_pct
FROM events WHERE created_at >= :since;

\echo '== 5. Invite funnel by type: unique opens -> claims (target: >= 25%)'
WITH opens AS (
  SELECT props->>'inviteType' AS type,
         count(DISTINCT coalesce(user_id::text, 'anon:' || id) || ':' || (props->>'inviteId')) AS unique_opens
  FROM events WHERE name = 'invite_opened' AND created_at >= :since GROUP BY 1
), claims AS (
  SELECT props->>'inviteType' AS type, count(*) AS claims,
         count(*) FILTER (WHERE (props->>'isNewUser')::boolean) AS new_users,
         count(*) FILTER (WHERE props->>'source' = 'open') AS from_open_pool
  FROM events WHERE name = 'spot_claimed' AND created_at >= :since GROUP BY 1
), created AS (
  SELECT props->>'inviteType' AS type, count(*) AS links_created
  FROM events WHERE name = 'invite_created' AND created_at >= :since GROUP BY 1
)
SELECT t.type, coalesce(links_created, 0) AS links_created, coalesce(unique_opens, 0) AS unique_opens,
       coalesce(claims, 0) AS claims, round(100.0 * claims / nullif(unique_opens, 0), 1) AS claim_rate_pct,
       coalesce(new_users, 0) AS new_users, coalesce(from_open_pool, 0) AS from_open_pool
FROM (VALUES ('vouch'), ('public')) t(type)
LEFT JOIN created USING (type) LEFT JOIN opens USING (type) LEFT JOIN claims USING (type);

\echo '== 6. K-factor: new users brought in by invites / bookers'
SELECT round(count(*) FILTER (WHERE name = 'spot_claimed' AND (props->>'isNewUser')::boolean)::numeric
             / nullif(count(DISTINCT user_id) FILTER (WHERE name = 'booking_created'), 0), 2) AS k_factor
FROM events WHERE created_at >= :since;

\echo '== 7. Plans that actually happened (past plans with booker + >= 1 guest)'
SELECT count(*) AS past_plans,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM spots s WHERE s.plan_id = p.id AND s.status = 'claimed')) AS happened
FROM plans p JOIN activities a ON a.id = p.activity_id
WHERE a.starts_at < now() AND p.created_at >= :since;

\echo '== 8. Held spots: filled vs released (are holds working?)'
SELECT count(*) FILTER (WHERE status = 'claimed' AND invite_id IS NOT NULL) AS claimed_via_invite,
       count(*) FILTER (WHERE status = 'held')     AS still_held,
       count(*) FILTER (WHERE status = 'released') AS released_unfilled
FROM spots s JOIN plans p ON p.id = s.plan_id WHERE p.created_at >= :since AND s.status <> 'booker';

\echo '== 9. Raw event volume'
SELECT name, count(*) FROM events WHERE created_at >= :since GROUP BY 1 ORDER BY 2 DESC;
