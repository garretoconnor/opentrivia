-- Align daily content with board clues. Preserve existing text and snapshots.
ALTER TABLE daily_questions RENAME COLUMN prompt TO clue;
ALTER TABLE daily_challenges RENAME COLUMN prompt TO clue;
ALTER TABLE daily_questions ADD COLUMN topic TEXT NOT NULL DEFAULT '';
ALTER TABLE daily_challenges ADD COLUMN topic TEXT NOT NULL DEFAULT '';
ALTER TABLE daily_questions ADD COLUMN image TEXT NOT NULL DEFAULT '';
ALTER TABLE daily_challenges ADD COLUMN image TEXT NOT NULL DEFAULT '';
