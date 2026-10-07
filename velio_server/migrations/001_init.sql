-- Postgres is the single source of truth for spot counts (see Plans.MD, Global Constraints).

CREATE TABLE users (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,  -- unique on its own: matching phone = same user
  email      TEXT NOT NULL UNIQUE,  -- unique on its own: matching email = same user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id         BIGSERIAL PRIMARY KEY,
  host_id    BIGINT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  starts_at  TIMESTAMPTZ NOT NULL,
  capacity   INT NOT NULL CHECK (capacity > 0),
  -- The oversell guard: no transaction can commit a negative count.
  spots_left INT NOT NULL CHECK (spots_left >= 0 AND spots_left <= capacity),
  version    BIGINT NOT NULL DEFAULT 0,  -- bumped on every count change; clients drop stale SSE messages
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  id              BIGSERIAL PRIMARY KEY,
  activity_id     BIGINT NOT NULL REFERENCES activities(id),
  booker_id       BIGINT NOT NULL REFERENCES users(id),
  hold_expires_at TIMESTAMPTZ NOT NULL,
  warned_pct      SMALLINT NOT NULL DEFAULT 0,  -- last hold warning emitted: 0, 50 or 90
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE spot_status AS ENUM ('booker', 'held', 'claimed', 'released');

CREATE TABLE spots (
  id          BIGSERIAL PRIMARY KEY,
  plan_id     BIGINT NOT NULL REFERENCES plans(id),
  activity_id BIGINT NOT NULL REFERENCES activities(id),
  status      spot_status NOT NULL,
  user_id     BIGINT REFERENCES users(id),  -- occupant once status is booker/claimed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status IN ('booker', 'claimed')) = (user_id IS NOT NULL))
);

-- One person can't occupy two spots in the same activity (e.g. via vouch + public URL).
CREATE UNIQUE INDEX one_spot_per_user_per_activity
  ON spots (activity_id, user_id) WHERE status IN ('booker', 'claimed');

CREATE TYPE invite_type AS ENUM ('vouch', 'public');

CREATE TABLE invites (
  id         BIGSERIAL PRIMARY KEY,
  plan_id    BIGINT NOT NULL REFERENCES plans(id),
  type       invite_type NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  label      TEXT,                                -- who the booker is vouching for
  spot_id    BIGINT UNIQUE REFERENCES spots(id),  -- vouch only: the held spot it binds
  used_at    TIMESTAMPTZ,                         -- vouch only: single-use
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type = 'vouch' OR (spot_id IS NULL AND used_at IS NULL))
);

CREATE UNIQUE INDEX one_public_invite_per_plan ON invites (plan_id) WHERE type = 'public';

-- Attribution: which invite a claimed spot came through.
ALTER TABLE spots ADD COLUMN invite_id BIGINT REFERENCES invites(id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

INSERT INTO settings (key, value) VALUES ('new_user_cap', '2');

CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  user_id     BIGINT,
  activity_id BIGINT,
  plan_id     BIGINT,
  props       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_name_created_at ON events (name, created_at);
