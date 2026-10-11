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
  prompt TEXT NOT NULL CHECK(length(trim(prompt)) BETWEEN 1 AND 2000),
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
  prompt TEXT NOT NULL,
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
