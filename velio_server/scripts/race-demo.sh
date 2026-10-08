#!/usr/bin/env bash
# Live "zero oversell" demo: N guests claim the LAST spot of an activity at the same moment.
# Expect exactly 1 winner, N-1 "race_lost", and the database still consistent.
#   ./scripts/race-demo.sh            # 20 guests
#   GUESTS=50 ./scripts/race-demo.sh
set -euo pipefail
API=${API:-http://localhost:3000}
GUESTS=${GUESTS:-20}
RUN=$RANDOM$RANDOM
OUT=$(mktemp -d)

post() { curl -s -X POST "$API$1" -H 'content-type: application/json' ${3:+-H "X-User-Id: $3"} -d "$2"; }
user() { post /users "{\"name\":\"$1\",\"phone\":\"+1$RUN$2\",\"email\":\"$1-$RUN-$2@race.demo\"}" | jq -r .id; }

host=$(user host 0)
starts=$(date -u -v+2d +%Y-%m-%dT18:00:00Z 2>/dev/null || date -u -d '+2 days' +%Y-%m-%dT18:00:00Z)
activity=$(post /activities "{\"title\":\"Race demo $RUN\",\"startsAt\":\"$starts\",\"capacity\":2}" "$host" | jq -r .id)
booker=$(user booker 1)
plan=$(post /bookings "{\"activityId\":\"$activity\",\"heldSpots\":0}" "$booker" | jq -r .planId)
token=$(post "/plans/$plan/invites" '{"type":"public"}' "$booker" | jq -r .token)
echo "Activity $activity: capacity 2, booker took 1 → 1 spot left. Public link $token"

guests=()
for i in $(seq 1 "$GUESTS"); do guests+=("$(user guest "$((i + 10))")"); done
echo "Firing $GUESTS simultaneous claims…"
for g in "${guests[@]}"; do
  curl -s -o "$OUT/$g.json" -w '%{http_code}\n' -X POST "$API/invites/$token/claim" -H "X-User-Id: $g" >"$OUT/$g.code" &
done
wait

won=$(cat "$OUT"/*.code | grep -c '^201$' || true)
lost=$(grep -l '"race_lost"' "$OUT"/*.json | wc -l | tr -d ' ')
left=$(curl -s "$API/activities/$activity/availability" | jq .spotsLeft)
echo "Winners: $won   race_lost: $lost   spots left: $left"
rm -rf "$OUT"
if [ "$won" = 1 ] && [ "$lost" = $((GUESTS - 1)) ] && [ "$left" = 0 ]; then
  echo "✅ No oversell: exactly one guest got the last spot."
else
  echo "❌ Unexpected result" && exit 1
fi
