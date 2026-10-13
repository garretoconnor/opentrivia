-- Historical attempts remain unranked because they have no measured time.
ALTER TABLE daily_attempts ADD COLUMN completion_ms INTEGER CHECK(completion_ms >= 0);
CREATE TABLE daily_runs (
  day TEXT NOT NULL REFERENCES daily_challenges(day),
  player_id TEXT NOT NULL REFERENCES daily_players(id),
  started_at INTEGER NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0, 1)),
  PRIMARY KEY(day, player_id)
);
