# OpenTrivia data model

Published games are stored in Cloudflare D1 as metadata and a nested `game_json` document. Games contain ordered boards; boards contain topic columns; columns contain clues. Daily trivia stores question-bank content and immutable daily challenge snapshots in relational tables.

## Shared question content

| Field | Meaning | Default |
| --- | --- | --- |
| `topic` | Category; inherited from the board column or stored on the daily question | Empty string for daily questions |
| `clue` | Text shown to players | Required; blank while authoring boards |
| `answer` | Canonical correct response | Required; blank while authoring boards |
| `accepted_answers` | Alternative correct responses, as an array of strings | `[]` |
| `explanation` | Explanation accompanying the revealed answer | Empty string |
| `image` | Optional image URL or data URL | Empty string |

D1 stores `accepted_answers` as JSON text. Board JSON stores it as an array. Board clues additionally have a derived `value` for standard rounds; boss clues use wagers and omit `value`. Daily attempts award zero or one point. Daily grading normalizes case, whitespace, and Unicode compatibility forms before comparing with the canonical answer and alternatives. Hosted and local board games retain manual judging.

Daily APIs expose only `topic`, `clue`, and `image` before submission. The correct answer and explanation are returned after that player's submission. The challenge snapshots all content fields when a question is assigned, so question-bank changes do not affect grading or presentation for an existing day.

Legacy game imports and saved games convert `answer` (displayed text) to `clue`, and `question` (correct response) to `answer`. New exports use the shared names. Migration `0003_consistent_question_content.sql` renames daily `prompt` to `clue` without changing stored text, and adds topic and image fields with empty defaults. Historical specification files describe earlier formats.

## Relationships

Solid arrows denote relational database relationships. Dotted arrows denote embedded data or runtime references.

```mermaid
flowchart TD
    subgraph D1[Persistent relational data]
        G[games]
        P[plays]
        V[votes]
        S[daily_seasons]
        Q["daily_questions<br/>topic, clue, answer, image<br/>accepted_answers, explanation"]
        C["daily_challenges<br/>day, season_id, question_id<br/>Question content snapshot"]
        DP[daily_players]
        A["daily_attempts<br/>day, player_id, answer, points"]
        G -->|1 to 0..many| P
        G -->|1 to 0..many| V
        S -->|1 to 0..many| C
        Q -->|1 to 0..1| C
        C -->|1 to 0..many| A
        DP -->|1 to 0..many| A
    end
    subgraph Content[Nested game document]
        GD[Game]
        B[Board]
        COL["Column<br/>topic"]
        CL["Clue<br/>clue, answer, image<br/>accepted_answers, explanation<br/>value for standard rounds"]
        GD -.->|contains 1..many| B
        B -.->|contains 1..16| COL
        COL -.->|contains 1..16| CL
    end
    subgraph Runtime[Temporary room state]
        R[Room]
        RP[Room player]
        AC[Active clue]
        R -.->|contains 0..8| RP
        R -.->|contains 0..1| AC
        AC -.->|references current buzzer| RP
    end
    G -.->|game_json embeds| GD
    R -.->|embeds game snapshot| GD
    AC -.->|references by board, column, row| CL
```

Each vote is unique per game and voter. Each daily attempt is unique per day and daily player. Season ranges cannot overlap. Published game rating totals, weekly play counts, and daily seasonal scores are computed from their underlying records. Room players, daily players, and voters have separate identities. Rooms expire after six hours or are deleted when the host closes them.
