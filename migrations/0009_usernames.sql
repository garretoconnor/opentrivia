-- Existing accounts choose a username on their next profile visit.
ALTER TABLE auth_users ADD COLUMN username TEXT COLLATE NOCASE
  CHECK(username IS NULL OR (length(username) BETWEEN 3 AND 30 AND username NOT GLOB '*[^a-z0-9_]*'));
CREATE UNIQUE INDEX auth_users_username_unique ON auth_users(username) WHERE username IS NOT NULL;
CREATE TRIGGER username_matches_name_insert BEFORE INSERT ON auth_users
WHEN NEW.username IS NOT NULL AND NEW.name != NEW.username
BEGIN SELECT RAISE(ABORT, 'Username must match name'); END;
CREATE TRIGGER username_matches_name_update BEFORE UPDATE ON auth_users
WHEN NEW.username IS NOT NULL AND NEW.name != NEW.username
BEGIN SELECT RAISE(ABORT, 'Username must match name'); END;
CREATE TRIGGER username_daily_name AFTER UPDATE OF name ON auth_users
BEGIN UPDATE daily_players SET name = NEW.name WHERE account_id = NEW.id; END;
