# OpenTrivia

OpenTrivia is a dependency-free browser toolkit for creating, publishing, discovering, and hosting custom trivia games with friends.

In hosted games, players join from their own devices, buzz on revealed clues, submit timed answers, and receive server-authoritative scores. The room awards the first buzz, shows a 30-second countdown plus five seconds of red overtime, and reopens missed clues for players who have not attempted them yet.

## Run locally

```sh
npm run dev
```

Then open <http://localhost:4173>. The static development server uses a browser-local preview for publishing and rooms. The Cloudflare deployment uses D1 for the public library, ratings, and weekly play counts, plus a Durable Object for ephemeral rooms.

## Verify

```sh
npm test
npm run build
```

GitHub Actions runs `npm ci`, `npm test`, and `npm run build:worker` for every pull request and push to `main`. The **Tests and Worker build** check uses Node.js 24 on Linux. The Worker build also generates the browser assets. CI needs no Cloudflare credentials and does not deploy or change the database. New commits cancel older runs for the same branch or pull request.

## Deploy on Cloudflare

The project uses `cf` with `cloudflare.config.ts`. `wrangler.config.ts` supplies the build settings. The build runs `scripts/build.mjs` before packaging the Worker, so the generated entrypoint and browser assets stay current.

Install the dependencies with `npm ci`. Confirm account access with `npx cf auth whoami`. The configuration points to the existing `opentrivia` Worker and D1 database.

Apply database migrations before deployment:

```sh
npx cf d1 migrations apply 5951b3b3-d55d-4e4f-ad61-c62840ba4e3c
npm run build:worker
npm run deploy
```

`npm run build:worker` packages the Worker locally. `npm run deploy` builds and deploys it. The remote migration command changes the production database. The migration directory remains `migrations/`, and the migration tracking table remains `d1_migrations`.

The original `wrangler.toml` is retained as a conversion reference. Make future configuration changes in `cloudflare.config.ts` and `wrangler.config.ts`.

Published game JSON and uploaded hero/clue images are stored in D1. Room state—including joined players, buzz order, deadlines, rulings, and scores—is serialized by a Durable Object. It expires after six hours and is deleted immediately when the host closes the room.

Boards and complete games can be imported and exported with the JSON format from [`spec_v0_1.md`](spec_v0_1.md), extended in v0.2 with `difficulty`, `hero_image`, and an optional `image` on each clue. Version 0.3 adds live hosted buzzing without changing the game-file schema. Boss clues deliberately have no `value` because their scoring is wager-based.

## Daily trivia

The **Daily trivia** tab serves one shared question per trivia day, with a daily leaderboard and totals for the current season. A trivia day rolls over at **02:00 EST / 07:00 UTC year-round** (03:00 on clocks observing Eastern daylight time). Selection happens on the first request after rollover; no cron job is required, and inactive days do not consume questions. Open tabs refresh at rollover and when returning to the tab; leaderboards can also be refreshed manually.

Players choose a public display name. A server-issued, HttpOnly cookie remembers their identity for one year; each browser identity can submit once per day. Correct answers earn one point, incorrect answers earn zero. Equal scores share a rank. The top 100 players are displayed. This is casual browser-based identity, not account authentication: clearing cookies or using another browser creates a new player, and progress does not sync across devices.

### Automatic seasons and question writing

Apply `migrations/0002_daily_trivia.sql` using the deployment migration command above. The migration deliberately creates **no questions**. The app creates seasons automatically on the first request in each season. Manage questions privately through D1 SQL (there is no public bank-writing API). Write a private SQL file and apply it with:

```sh
npx cf d1 query 5951b3b3-d55d-4e4f-ad61-c62840ba4e3c --sql "$(cat /path/to/your-daily-content.sql)"
```

Default seasons repeat every year:

| Season | Months | Start | End (exclusive) |
| --- | --- | --- | --- |
| Spring | March, April, May | March 1 | June 1 |
| Summer | June, July, August | June 1 | September 1 |
| Fall | September, October, November | September 1 | December 1 |
| Winter | December, January, February | December 1 | March 1 of the next year |

Season changes occur at the daily rollover: 02:00 EST / 07:00 UTC. Winter uses its starting year in its ID, such as `winter-2026`, and the display name **Winter 2026–2027**. Scores stay in the same winter season across New Year and through leap day. The next season starts with a new leaderboard. No annual setup or scheduled job is required.

Existing manually configured seasons are preserved. A default season is created only when its date range does not overlap an existing season. If you manually configure seasons, use complete calendar-season ranges to avoid gaps, and keep started season IDs and boundaries unchanged.

Add your own rows to `daily_questions` with these fields:

| Field | Purpose |
| --- | --- |
| `id` | Unique stable text ID you choose |
| `prompt` | Question text, 1–2,000 characters |
| `answer` | Canonical correct answer, 1–300 characters |
| `accepted_answers` | JSON array of alternative accepted strings; defaults to `[]` |
| `explanation` | Optional explanation revealed after submission |
| `enabled` | `0` for draft (default), `1` to make it eligible |
| `queue_order` | Integer; lower values are selected first, then ID |

Grading ignores capitalization, surrounding/repeated whitespace, and Unicode compatibility variants. Punctuation and wording otherwise need to match; add alternate spellings or phrasings to `accepted_answers`. Use SQL parameters or properly escape single quotes in authored SQL. Keep authored content outside the public browser assets.

Each question is used once across all seasons. The first daily request atomically saves the next eligible unused question and its answers into `daily_challenges`. All players receive that snapshot, including if the bank is later edited or the question disabled. Answers and explanations are only returned after that player submits. If the bank is exhausted, play pauses with an empty state; adding an enabled question makes it available on the next request. Existing leaderboards remain visible. Do not edit challenge snapshots or delete used questions.

### Preview daily trivia locally

The static preview cannot provide shared daily trivia. Use the local Worker and local D1 instead. The Wrangler development server uses `.wrangler/state`; pass that directory to local D1 commands so they use the same database:

```sh
npx cf d1 migrations apply 5951b3b3-d55d-4e4f-ad61-c62840ba4e3c --local --persist-to .wrangler/state
# Optionally apply your own questions to the local database:
npx cf d1 query 5951b3b3-d55d-4e4f-ad61-c62840ba4e3c --local --persist-to .wrangler/state --sql "$(cat /path/to/your-daily-content.sql)"
npm run dev:worker
```

`npm test` includes SQLite-backed tests for concurrent assignment/submission, grading, answer privacy, rollover, seasonal totals, and empty states. These tests require Node.js 22.13 or newer with `node:sqlite` available.
