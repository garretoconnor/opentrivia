CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hero_image TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  game_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, voter_id)
);

CREATE INDEX IF NOT EXISTS plays_game_week ON plays(game_id, played_at);
CREATE INDEX IF NOT EXISTS votes_game ON votes(game_id);
-- All dates are trivia-day labels (YYYY-MM-DD), changing at 07:00 UTC / 02:00 EST.
CREATE TABLE daily_seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  starts_on TEXT NOT NULL CHECK(starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on TEXT NOT NULL CHECK(ends_on > starts_on)
);
CREATE TRIGGER daily_seasons_no_overlap_insert BEFORE INSERT ON daily_seasons
WHEN EXISTS (SELECT 1 FROM daily_seasons WHERE starts_on < NEW.ends_on AND ends_on > NEW.starts_on)
BEGIN SELECT RAISE(ABORT, 'Season dates must not overlap'); END;
CREATE TRIGGER daily_seasons_no_overlap_update BEFORE UPDATE ON daily_seasons
WHEN EXISTS (SELECT 1 FROM daily_seasons WHERE id != OLD.id AND starts_on < NEW.ends_on AND ends_on > NEW.starts_on)
BEGIN SELECT RAISE(ABORT, 'Season dates must not overlap'); END;

CREATE TABLE daily_questions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  clue TEXT NOT NULL CHECK(length(trim(clue)) BETWEEN 1 AND 2000),
  answer TEXT NOT NULL CHECK(length(trim(answer)) BETWEEN 1 AND 300),
  accepted_answers TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(accepted_answers) AND json_type(accepted_answers) = 'array'),
  explanation TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  queue_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE daily_challenges (
  day TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES daily_seasons(id),
  question_id TEXT NOT NULL UNIQUE REFERENCES daily_questions(id),
  topic TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  clue TEXT NOT NULL,
  answer TEXT NOT NULL,
  accepted_answers TEXT NOT NULL,
  explanation TEXT NOT NULL
);
CREATE TABLE daily_players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 30)
);
CREATE TABLE daily_attempts (
  day TEXT NOT NULL REFERENCES daily_challenges(day),
  player_id TEXT NOT NULL REFERENCES daily_players(id),
  answer TEXT NOT NULL,
  points INTEGER NOT NULL CHECK(points IN (0, 1)),
  submitted_at TEXT NOT NULL,
  PRIMARY KEY(day, player_id)
);
CREATE INDEX daily_challenges_season ON daily_challenges(season_id, day);
CREATE INDEX daily_attempts_player ON daily_attempts(player_id, day);

-- Historical attempts remain unranked because they have no measured time.
ALTER TABLE daily_attempts ADD COLUMN completion_ms INTEGER CHECK(completion_ms >= 0);
CREATE TABLE daily_runs (
  day TEXT NOT NULL REFERENCES daily_challenges(day),
  player_id TEXT NOT NULL REFERENCES daily_players(id),
  started_at INTEGER NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0, 1)),
  PRIMARY KEY(day, player_id)
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 3 AND 30),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 30),
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX account_sessions_account ON account_sessions(account_id);
CREATE TABLE auth_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
ALTER TABLE daily_players ADD COLUMN account_id TEXT REFERENCES accounts(id);
CREATE UNIQUE INDEX daily_players_account ON daily_players(account_id) WHERE account_id IS NOT NULL;
CREATE TABLE daily_claims (
  player_id TEXT PRIMARY KEY REFERENCES daily_players(id),
  account_id TEXT NOT NULL REFERENCES accounts(id)
);
CREATE TABLE account_games (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  game_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  published_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX account_games_owner ON account_games(account_id, updated_at);
ALTER TABLE games ADD COLUMN account_id TEXT REFERENCES accounts(id);

-- Replace the credential/session implementation while preserving every user ID
-- and all existing application foreign keys. Email stays nullable only for
-- legacy users awaiting verified-email enrollment; Better Auth requires it
-- on every new signup. Legacy usernames remain reserved.
CREATE TABLE legacy_auth_credentials (
  account_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL
);
INSERT INTO legacy_auth_credentials SELECT id, password_hash, recovery_hash FROM accounts;
DROP TABLE account_sessions;
DROP TABLE auth_limits;
ALTER TABLE accounts RENAME TO auth_users;
ALTER TABLE auth_users ADD COLUMN email TEXT;
ALTER TABLE auth_users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_users ADD COLUMN image TEXT;
ALTER TABLE auth_users ADD COLUMN createdAt DATE NOT NULL DEFAULT 0;
ALTER TABLE auth_users ADD COLUMN updatedAt DATE NOT NULL DEFAULT 0;
ALTER TABLE auth_users ADD COLUMN displayUsername TEXT;
UPDATE auth_users SET createdAt = CAST(strftime('%s', created_at) AS INTEGER) * 1000,
  updatedAt = CAST(strftime('%s', created_at) AS INTEGER) * 1000, displayUsername = username;
ALTER TABLE auth_users DROP COLUMN password_hash;
ALTER TABLE auth_users DROP COLUMN recovery_hash;
ALTER TABLE auth_users DROP COLUMN created_at;
CREATE UNIQUE INDEX auth_users_email_unique ON auth_users(email);

create table "auth_sessions" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_users" ("id") on delete cascade);

create table "auth_credentials" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_users" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "auth_verifications" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "auth_rate_limits" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "auth_sessions_userId_idx" on "auth_sessions" ("userId");

create index "auth_credentials_userId_idx" on "auth_credentials" ("userId");

create index "auth_verifications_identifier_idx" on "auth_verifications" ("identifier");

-- Rebuild the user table because SQLite cannot drop a UNIQUE column.
-- D1 keeps foreign keys enabled; preserve rows affected by ON DELETE CASCADE.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE account_games_username_backup AS SELECT * FROM account_games;
CREATE TABLE auth_sessions_username_backup AS SELECT * FROM auth_sessions;
CREATE TABLE auth_credentials_username_backup AS SELECT * FROM auth_credentials;
CREATE TABLE auth_users_without_username (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 30),
  email TEXT,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt DATE NOT NULL DEFAULT 0,
  updatedAt DATE NOT NULL DEFAULT 0
);
INSERT INTO auth_users_without_username (id, name, email, emailVerified, image, createdAt, updatedAt)
  SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM auth_users;
DROP TABLE auth_users;
ALTER TABLE auth_users_without_username RENAME TO auth_users;
CREATE UNIQUE INDEX auth_users_email_unique ON auth_users(email);
INSERT INTO account_games SELECT * FROM account_games_username_backup;
INSERT INTO auth_sessions SELECT * FROM auth_sessions_username_backup;
INSERT INTO auth_credentials SELECT * FROM auth_credentials_username_backup;
DROP TABLE account_games_username_backup;
DROP TABLE auth_sessions_username_backup;
DROP TABLE auth_credentials_username_backup;
PRAGMA defer_foreign_keys = OFF;
