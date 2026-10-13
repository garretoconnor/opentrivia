# OpenTrivia

OpenTrivia is a browser toolkit for creating, publishing, discovering, and hosting custom trivia games with friends.

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

`npm run build:worker` packages the Worker locally. `npm run deploy` builds and deploys it. `npm run deploy:prebuilt` deploys the existing validated build without rebuilding. The remote migration command changes the production database. The migration directory remains `migrations/`, and the migration tracking table remains `d1_migrations`.

### Manual deployment button

After this workflow is merged, open **Actions → Deploy built Worker → Run workflow** in GitHub. Select **main**, then click **Run workflow**. This deploys to the existing production Worker; there is no staging environment.

First, add a repository Actions secret named `CLOUDFLARE_API_TOKEN` in **Settings → Secrets and variables → Actions**. Use a Cloudflare API token for the configured account with Worker deployment and D1 migration permissions. The account ID is already in `cloudflare.config.ts`. Your local Cloudflare sign-in is not available on GitHub runners. Never put the token in a file or PR.

The action checks the credential, installs locked dependencies, runs tests, builds the Worker, and validates the build. It then applies pending production database migrations and deploys that exact build with `npm run deploy:prebuilt`. A failed step stops deployment. If deployment fails after a migration, that migration remains applied. Keep schema changes compatible with the running Worker.

The prebuilt deployment script reads the validated Cloudflare Build Output and generates a git-ignored Wrangler configuration from it. Wrangler uploads the existing bundle with bundling disabled. This avoids the pinned `cf` CLI’s forced strict mode, which can reject equivalent binding metadata after a Dashboard change (for example, setting the admin secret). The repository’s bindings remain authoritative; Dashboard variables and Worker secrets are preserved. Validation uses `npm run deploy:prebuilt -- --dry-run` and does not contact the production Worker, so it cannot verify remote permissions or deployment success.

Only manual runs from `main` can deploy. Deployments do not run on merges. Concurrent deployment runs are serialized. This button creates a fresh tested build from the selected main revision; it does not select an artifact from a prior CI run.

The original `wrangler.toml` is retained as a conversion reference. Make future configuration changes in `cloudflare.config.ts` and `wrangler.config.ts`.

Published game JSON and uploaded hero/clue images are stored in D1. Room state—including joined players, buzz order, deadlines, rulings, and scores—is serialized by a Durable Object. It expires after six hours and is deleted immediately when the host closes the room.

Boards and complete games use the current [data model](docs/data-model.md). Clue content uses `clue` for displayed text and `answer` for the correct response, with optional `image`, `accepted_answers`, and `explanation`. Imports still accept the legacy format from [`spec_v0_1.md`](spec_v0_1.md), where `answer` meant displayed text and `question` meant the correct response. Version 0.2 added `difficulty` and `hero_image`; version 0.3 added live hosted buzzing. Boss clues deliberately have no `value` because their scoring is wager-based.

## Daily trivia

The **Daily trivia** tab serves one shared question per trivia day, with daily and seasonal completion-time leaderboards. A trivia day rolls over at **02:00 EST / 07:00 UTC year-round** (03:00 on clocks observing Eastern daylight time). Selection happens on the first request after rollover; no cron job is required, and inactive days do not consume questions. Open tabs refresh at rollover and when returning to the tab; leaderboards can also be refreshed manually.

Before Play, only the topic is revealed. Play creates a server-timed run and reveals the clue and answer field. Players can enter a public display name with their answer. A server-issued, HttpOnly cookie remembers their identity for one year; each browser identity can submit once per day. Only correct answers with valid completion times rank. The daily board ranks fastest first; the season board ranks by average time across valid correct completions and shows the completion count. Equal times share a rank. Switching tabs or windows, or reloading an unfinished run, permanently voids that day’s time; the player can still answer. Start times and voids persist on the server, and repeat Play requests cannot restart the clock. Browser focus events provide casual enforcement, not protection against a modified client. The top 100 players are displayed. Guest play uses casual browser-based identity: clearing cookies or using another browser creates a new guest. Signed-in players use their cloud account across devices; see Accounts and private cloud games below.

### Automatic seasons and question writing

Apply all pending migrations using the deployment migration command above. `0002_daily_trivia.sql` creates the daily tables; `0003_consistent_question_content.sql` renames `prompt` to `clue` and adds `topic` and `image` to both the question bank and challenge snapshots. `0004_daily_timing.sql` adds persistent runs and completion times. Existing attempts are preserved without a time and excluded from time rankings. The column rename requires the updated Worker; coordinate this migration with deployment, since the previous Worker expects `prompt`. The migration deliberately creates **no questions**. The app creates seasons automatically on the first request in each season. Use the protected admin interface below to add questions, or manage them privately through D1 SQL. To use SQL, write a private file and apply it with:

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
| `topic` | Topic/category; defaults to an empty string |
| `clue` | Text shown to players, 1–2,000 characters |
| `answer` | Canonical correct answer, 1–300 characters |
| `image` | Optional image URL or data URL; defaults to an empty string |
| `accepted_answers` | JSON array of alternative accepted strings; defaults to `[]` |
| `explanation` | Optional explanation revealed after submission |
| `enabled` | `0` for draft (default), `1` to make it eligible |
| `queue_order` | Integer; lower values are selected first, then ID |

Grading ignores capitalization, surrounding/repeated whitespace, and Unicode compatibility variants. Punctuation and wording otherwise need to match; add alternate spellings or phrasings to `accepted_answers`. Use SQL parameters or properly escape single quotes in authored SQL. Keep authored content outside the public browser assets.

Daily questions and board clues share the same content fields. A board clue inherits its topic from its column; a daily question stores its own topic. Board clues retain their row-based or wager-based scoring, and hosts continue to judge responses manually. The board editor supports alternative accepted answers and explanations for reference during judging.

Each question is used once across all seasons. The first daily request atomically saves the next eligible unused question and its answers into `daily_challenges`. All players receive that snapshot, including if the bank is later edited or the question disabled. Answers and explanations are only returned after that player submits. If the bank is exhausted, play pauses with an empty state; adding an enabled question makes it available on the next request. Existing leaderboards remain visible. Do not edit challenge snapshots or delete used questions.

### Daily question bank admin

Open `/admin` on the deployed Worker (or `/admin.html` locally). The admin form adds questions to the existing D1 bank with a topic, question text, correct answer, alternate accepted answers (one per line), explanation, optional HTTPS image URL, and queue order. New questions default to **Ready for daily play**; uncheck that option to save a draft. The bank shows ready, draft, and used counts. Use **Make ready** or **Move to draft** for unused questions. Used questions cannot be changed here, and adding a question does not replace an existing daily snapshot. There is no new database migration.

Before using the page, add a secret named `ADMIN_TOKEN` to the `opentrivia` Worker in Cloudflare **Settings → Variables and Secrets**, using a long random access key. Deploy this change using the normal deployment workflow above. Enter the same key to unlock the admin page. All `/api/admin/*` requests require it; admin access remains disabled when the secret is missing. The page keeps the key only in memory, sends it in an Authorization header, and clears it when you lock or reload the page. Bank responses are never cached. Keep the key private and use the deployed page over HTTPS.

For local Worker development, create a git-ignored `.dev.vars` file in the repository root:

```dotenv
ADMIN_TOKEN=your-local-only-admin-key
```

Apply the existing local migrations and run `npm run dev:worker` as described below. The static `npm run dev` server can show the form at `/admin.html`, but saving and unlocking require the Worker and D1. Do not put a production key in source files or browser assets.

### Preview daily trivia locally

The static preview cannot provide shared daily trivia. Use the local Worker and local D1 instead. The Wrangler development server uses `.wrangler/state`; pass that directory to local D1 commands so they use the same database:

```sh
npx cf d1 migrations apply 5951b3b3-d55d-4e4f-ad61-c62840ba4e3c --local --persist-to .wrangler/state
# Optionally apply your own questions to the local database:
npx cf d1 query 5951b3b3-d55d-4e4f-ad61-c62840ba4e3c --local --persist-to .wrangler/state --sql "$(cat /path/to/your-daily-content.sql)"
npm run dev:worker
```

`npm test` includes SQLite-backed tests for concurrent assignment/submission, grading, answer privacy, rollover, seasonal totals, and empty states. These tests require Node.js 22.13 or newer with `node:sqlite` available.

### Game authoring settings

Use **Settings → Contains 18+ content** to label a game in the public library and publication review. **Row points** sets game-wide values for every standard round, with 100-, 200-, and 500-point increment presets or custom positive whole numbers. Boss rounds keep wager scoring.

Drag a clue's handle within its topic to reorder it, or focus the handle and use the up/down arrow keys. Reordering supports Undo. Points follow the destination row, and publishing/exporting derives clue values from the game's `row_values` array. The `adult_content` boolean and row values persist with the game. Legacy imports adopt the first standard topic's value for each row and default to all ages.

## Accounts and private cloud games

Accounts use **Better Auth 1.7.7** on the existing Worker/D1 database. Users create an account with a real email address, username, public display name, and password of 15–128 characters. Email verification is required before sign-in. Sign in with either username or email. **Forgot password** sends a one-use reset link and revokes all previous sessions after a successful reset. The account dialog also supports resending verification emails. Custom credential/session routes and recovery codes have been retired; `/api/account` remains a read-only application profile endpoint.

**My Games** contains private drafts and games you have published. **New game** creates a private cloud draft. Studio edits autosave after a short delay, with explicit saving, synced, pending, and conflict states. Device backups are scoped to the account; guest drafts are kept separately. Failed saves retain pending edits and can be retried. Revision checks prevent one device from silently replacing another device's changes; on conflict, save your edits as a new game or explicitly open the cloud version. Publishing requires all clues and responses and a successful cloud save. Republishing updates the existing public copy; later draft edits remain private until published again.

**Import local games** copies this browser's Studio draft and local preview library into private cloud drafts. Imports keep the originals and are idempotent for identical content. The account dialog offers **Claim this browser's guest daily history**. This transfers that guest history exactly once. Existing account answers win on overlapping days; overlapping times are voided, while non-overlapping answers retain server timing. A claimed guest cookie no longer exposes transferred results. Account identity, not browser identity, controls signed-in daily play. Guest play remains available.

### Cloudflare Email Service and auth configuration

The Worker declares `AUTH_EMAIL`, a native Cloudflare Email Service send binding restricted to sender **bot@okener.com**, and `AUTH_EMAIL_FROM=bot@okener.com`. Verification/reset emails use this binding directly; there is no external email API key or provider. The domain owner reports that **okener.com is onboarded to Email Service**; production delivery still needs verification after deployment.

Before production rollout:

1. Confirm that outbound Email Service domain verification is complete and sending from `bot@okener.com` is permitted. This is Email Service outbound sending, rather than only inbound Email Routing. See [sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/) and [domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/).
2. Set a high-entropy `BETTER_AUTH_SECRET` Worker secret (at least 32 characters; generate at least 32 random bytes). Keep it out of source, GitHub logs, and browser assets. `cloudflare.config.ts` sets `BETTER_AUTH_URL=https://trivia.okener.com`; attach that custom domain to the `opentrivia` Worker and use the same value in any Dashboard configuration. The URL must be the exact public HTTPS application origin without a path. The existing prebuilt deploy preserves Dashboard variables and Worker secrets. Never use a deployment/API token as this auth secret.
3. Apply migrations through `0006_better_auth.sql`, then deploy the tested Worker. Review the legacy-account procedure below before applying to a populated custom-auth database. Existing custom sessions are intentionally invalidated. No migration runs from an HTTP request.
4. After domain setup and deployment, test verification/reset delivery with an owner-approved test mailbox. Local simulation proves integration logic, not inbox delivery or domain entitlement. Do not enable remote email bindings for routine tests.

Better Auth owns credentials, session cookies, and verification/reset tokens. Cookies are HttpOnly and Secure on HTTPS; sessions last up to 30 days. Cookie caching is disabled, and password reset revokes sessions. Its database token representation differs from the previous custom hashed-token implementation. Auth endpoints use persistent database rate limits with a trusted Cloudflare IP header, plus an atomic per-identifier sign-in limit shared across IPs. Application ownership and daily scoring checks remain separate. Auth responses are `no-store`, and auth POSTs require same-origin JSON requests.

### Local account development

The static `npm run dev` preview remains guest-only. For accounts, use `npm run dev:worker` and apply migrations to local D1. Store local configuration in git-ignored `.dev.vars` (keep any existing values):

```text
BETTER_AUTH_SECRET=<generate a unique random development secret>
BETTER_AUTH_URL=http://localhost:8787
```

`AUTH_EMAIL_FROM` and the local send binding come from the Worker config. Default local email bindings simulate delivery; Wrangler prints the path of each generated message under its temporary `files/email-text/` directory. Open the verification/reset link from that local text file. Nothing is sent to the mailbox, and domain onboarding is unnecessary for local simulation. See [Cloudflare's local email documentation](https://developers.cloudflare.com/email-service/local-development/sending/). `AUTH_EMAIL` is a native runtime binding; tests replace it with an in-memory mail sink, never a public HTTP endpoint that exposes tokens.

### Existing custom-auth accounts

Migration 0006 renames `accounts` to `auth_users`, preserving IDs and automatically retargeting application foreign keys. Games, plays, votes, daily players/results, guest claims, and private drafts remain intact. Legacy passwords/recovery hashes are archived in the server-only `legacy_auth_credentials` table; no HTTP route accepts them. Their usernames remain reserved. Existing users have a null email until enrollment, so there is no fabricated email or automatic reassignment of old data.

If custom-auth users exist, independently establish ownership of each old account before assigning its real email. Generate an enrollment SQL file for review:

```sh
node scripts/enroll-legacy-account.mjs USER_UUID owner@example.com /tmp/enroll-user.sql
```

The script only writes a file and never contacts a database or sends mail. Apply the reviewed SQL through the normal D1 admin process after ownership is verified. The owner then uses **Forgot password** and **Resend verification email** to enroll through Better Auth; the same user ID retains its games and scores. Existing custom password hashes are not interpreted as Better Auth hashes. Keep the archive/backups access-controlled until the migration retention decision is made. Do not rewrite previously applied migrations.
