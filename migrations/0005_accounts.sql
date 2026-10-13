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
