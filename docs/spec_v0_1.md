# OpenTrivia

OpenTrivia is an open-source Javascript toolkit for hosting trivia games with your friends.

## Requirements

1. Users should be able to create trivia grids with 1 to 16 rows (default 5) and 1 to 16 columns (default 6).

2. Users should be able to name columns.

3. Users should be able to create cards (clue-answer pairs)

4. Users should be able to import and export boards as JSON with the schema:

"board": { 
  "columns": [
    {"topic": string,
    "size": int in [1...16]
    "clues": [
        {"value": int,
        "answer": string,
        "question": string
        },
        ...
        ]
    },
    ...
 ]}

6. Users should be able to create Boss Boards, boards with 1 column, 1 clue, and 1 answer

6a. For Boss Boards, the column name should be revealed first.

6b. Then, all players wager 1 to n points, where n is that player's current points.

6c. Then, the answer is revealed, and all players submit a guess.

6d. Players who guess the question correctly double their wager; those who guess incorrectly lose their wager.

6e. Players with fewer than zero points after a Boss round are eliminated.

7. Users should be able to create games of one or more board played in serial.

7a. A game may have any combination of normal and Boss rounds.

7b. Games should have a predetermined setting of 2-8 players (default 3).

7c. Users should be able to import and export games as JSON with the schema:

"game": {
    "name": string,
    "num_players": int from 2 to 8
    "size": int greater than or equal to 1
    "boards": [
        <follows board schema>
        ...
    ]
}

8. The app should be implemented in vanilla javascript, with performance and facility of UX as the key considerations.
