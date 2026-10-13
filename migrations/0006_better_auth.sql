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
