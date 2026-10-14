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
