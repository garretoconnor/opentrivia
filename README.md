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

## Deploy on Cloudflare

1. Create a D1 database named `opentrivia`.
2. Replace the placeholder `database_id` in `wrangler.toml` with its ID.
3. Apply the migration and deploy:

```sh
npx wrangler d1 migrations apply opentrivia --remote
npm run build
npx wrangler deploy
```

Published game JSON and uploaded hero/clue images are stored in D1. Room state—including joined players, buzz order, deadlines, rulings, and scores—is serialized by a Durable Object. It expires after six hours and is deleted immediately when the host closes the room.

Boards and complete games can be imported and exported with the JSON format from [`spec_v0_1.md`](spec_v0_1.md), extended in v0.2 with `difficulty`, `hero_image`, and an optional `image` on each clue. Version 0.3 adds live hosted buzzing without changing the game-file schema. Boss clues deliberately have no `value` because their scoring is wager-based.
