export const LIMITS = Object.freeze({
  minRows: 1,
  maxRows: 16,
  defaultRows: 5,
  minColumns: 1,
  maxColumns: 16,
  defaultColumns: 6,
  minPlayers: 2,
  maxPlayers: 8,
  defaultPlayers: 3,
});

export const DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);

export function defaultRowValues(step = 200) {
  return Array.from({ length: LIMITS.maxRows }, (_, row) => (row + 1) * step);
}

// Clue values remain a derived snapshot for board exports and existing players.
export function applyRowValues(game) {
  for (const board of game.boards) {
    for (const column of board.columns) column.clues.forEach((clue, row) => {
      if (isBossBoard(board)) delete clue.value;
      else clue.value = game.row_values[row];
    });
  }
  return game;
}

export function reorderClue(game, boardIndex, columnIndex, from, to) {
  const board = game.boards[boardIndex];
  if (!board || isBossBoard(board)) return false;
  const column = board.columns[columnIndex];
  if (!column || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= column.clues.length || to >= column.clues.length || from === to) return false;
  column.clues.splice(to, 0, column.clues.splice(from, 1)[0]);
  applyRowValues(game);
  return true;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createClue(row) {
  return { value: (row + 1) * 200, clue: "", answer: "", image: "", accepted_answers: [], explanation: "" };
}

export function createBoard(rows = LIMITS.defaultRows, columns = LIMITS.defaultColumns) {
  assertIntegerInRange(rows, LIMITS.minRows, LIMITS.maxRows, "Rows");
  assertIntegerInRange(columns, LIMITS.minColumns, LIMITS.maxColumns, "Columns");
  return {
    columns: Array.from({ length: columns }, (_, column) => ({
      topic: `Topic ${column + 1}`,
      size: rows,
      clues: Array.from({ length: rows }, (_, row) => createClue(row)),
    })),
  };
}

export function createBossBoard() {
  return {
    columns: [{ topic: "Boss topic", size: 1, clues: [{ clue: "", answer: "", image: "", accepted_answers: [], explanation: "" }] }],
  };
}

export function createGame() {
  const boards = [createBoard()];
  return {
    name: "Untitled game",
    num_players: LIMITS.defaultPlayers,
    size: boards.length,
    difficulty: "medium",
    hero_image: "",
    adult_content: false,
    row_values: defaultRowValues(),
    boards,
  };
}

export function isBossBoard(board) {
  return board?.columns?.length === 1 && board.columns[0]?.size === 1 && board.columns[0]?.clues?.length === 1;
}

export function resizeBoard(board, rows, columns) {
  assertIntegerInRange(rows, LIMITS.minRows, LIMITS.maxRows, "Rows");
  assertIntegerInRange(columns, LIMITS.minColumns, LIMITS.maxColumns, "Columns");
  while (board.columns.length < columns) {
    const index = board.columns.length;
    board.columns.push({ topic: `Topic ${index + 1}`, size: rows, clues: [] });
  }
  board.columns.length = columns;
  for (const column of board.columns) {
    while (column.clues.length < rows) column.clues.push(createClue(column.clues.length));
    column.clues.length = rows;
    column.size = rows;
  }
  return board;
}

export function normalizeBoard(input, label = "board") {
  const board = isObject(input) && "board" in input ? input.board : input;
  if (!isObject(board)) throw new Error(`${label} must be an object.`);
  if (!Array.isArray(board.columns)) throw new Error(`${label}.columns must be an array.`);
  assertIntegerInRange(board.columns.length, LIMITS.minColumns, LIMITS.maxColumns, `${label}.columns length`);

  if (board.title !== undefined && (typeof board.title !== "string" || board.title.length > 80)) throw new Error(`${label}.title must be a string of at most 80 characters.`);
  const boss = board.columns.length === 1
    && board.columns[0]?.size === 1
    && board.columns[0]?.clues?.length === 1;
  return {
    ...(board.title !== undefined ? { title: board.title } : {}),
    columns: board.columns.map((column, columnIndex) => {
      const path = `${label}.columns[${columnIndex}]`;
      if (!isObject(column)) throw new Error(`${path} must be an object.`);
      if (typeof column.topic !== "string") throw new Error(`${path}.topic must be a string.`);
      assertIntegerInRange(column.size, LIMITS.minRows, LIMITS.maxRows, `${path}.size`);
      if (!Array.isArray(column.clues)) throw new Error(`${path}.clues must be an array.`);
      if (column.clues.length !== column.size) {
        throw new Error(`${path}.clues must contain exactly ${column.size} clue${column.size === 1 ? "" : "s"}.`);
      }
      return {
        topic: column.topic,
        size: column.size,
        clues: column.clues.map((clue, clueIndex) => normalizeClue(clue, `${path}.clues[${clueIndex}]`, boss)),
      };
    }),
  };
}

function normalizeClue(input, path, boss = false) {
  if (!isObject(input)) throw new Error(`${path} must be an object.`);
  // Legacy board files used answer for the clue and question for the response.
  const clue = 'clue' in input ? input : { ...input, clue: input.answer, answer: input.question };
  if (!boss && !Number.isInteger(clue.value)) throw new Error(`${path}.value must be an integer.`);
  if (typeof clue.clue !== "string") throw new Error(`${path}.clue must be a string.`);
  if (typeof clue.answer !== "string") throw new Error(`${path}.answer must be a string.`);
  if (clue.image !== undefined && typeof clue.image !== "string") throw new Error(`${path}.image must be a string.`);
  if (clue.accepted_answers !== undefined && (!Array.isArray(clue.accepted_answers) || clue.accepted_answers.some(answer => typeof answer !== "string"))) {
    throw new Error(`${path}.accepted_answers must be an array of strings.`);
  }
  if (clue.explanation !== undefined && typeof clue.explanation !== "string") throw new Error(`${path}.explanation must be a string.`);
  return {
    ...(boss ? {} : { value: clue.value }),
    clue: clue.clue,
    answer: clue.answer,
    image: clue.image ?? "",
    accepted_answers: clue.accepted_answers ?? [],
    explanation: clue.explanation ?? "",
  };
}

export function normalizeAnswer(answer) {
  return answer.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

export function matchesAnswer(question, submittedAnswer) {
  return [question.answer, ...question.accepted_answers].some(answer =>
    typeof answer === 'string' && normalizeAnswer(answer) === normalizeAnswer(submittedAnswer));
}

export function normalizeGame(input) {
  const game = isObject(input) && "game" in input ? input.game : input;
  if (!isObject(game)) throw new Error("game must be an object.");
  if (typeof game.name !== "string") throw new Error("game.name must be a string.");
  const difficulty = game.difficulty ?? "medium";
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`game.difficulty must be one of: ${DIFFICULTIES.join(", ")}.`);
  if (game.hero_image !== undefined && typeof game.hero_image !== "string") throw new Error("game.hero_image must be a string.");
  assertIntegerInRange(game.num_players, LIMITS.minPlayers, LIMITS.maxPlayers, "game.num_players");
  if (!Number.isInteger(game.size) || game.size < 1) throw new Error("game.size must be an integer of at least 1.");
  if (!Array.isArray(game.boards)) throw new Error("game.boards must be an array.");
  if (game.boards.length !== game.size) throw new Error(`game.boards must contain exactly ${game.size} boards.`);
  if (game.adult_content !== undefined && typeof game.adult_content !== "boolean") throw new Error("game.adult_content must be a boolean.");
  const rowValues = game.row_values === undefined ? defaultRowValues() : game.row_values;
  if (!Array.isArray(rowValues) || rowValues.length < 1 || rowValues.length > LIMITS.maxRows || rowValues.some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error("game.row_values must contain 1 to 16 positive safe integers.");
  }
  const values = defaultRowValues();
  rowValues.forEach((value, row) => { values[row] = value; });
  const boards = game.boards.map((board, index) => normalizeBoard(game.row_values === undefined ? board : {
    ...board,
    columns: Array.isArray(board?.columns) ? board.columns.map(column => ({
      ...column,
      clues: Array.isArray(column?.clues) ? column.clues.map((clue, row) => isObject(clue) ? { ...clue, value: values[row] } : clue) : column?.clues,
    })) : board?.columns,
  }, `game.boards[${index}]`));
  // Legacy games adopt the first standard topic's values for each row.
  if (game.row_values === undefined) {
    for (let row = 0; row < LIMITS.maxRows; row++) {
      const clue = boards.filter(board => !isBossBoard(board)).flatMap(board => board.columns).find(column => column.clues[row])?.clues[row];
      if (Number.isSafeInteger(clue?.value) && clue.value > 0) values[row] = clue.value;
    }
  }
  return applyRowValues({
    name: game.name,
    num_players: game.num_players,
    size: game.size,
    difficulty,
    hero_image: game.hero_image ?? "",
    adult_content: game.adult_content ?? false,
    row_values: values,
    boards,
  });
}

export function difficultySymbol(difficulty) {
  const normalized = DIFFICULTIES.includes(difficulty) ? difficulty : "medium";
  return normalized === "easy" ? "●" : normalized === "medium" ? "■" : "◆";
}

export function exportBoard(board) {
  return JSON.stringify({ board: normalizeBoard(board) }, null, 2);
}

export function exportGame(game) {
  const clean = normalizeGame({ ...game, size: game.boards.length });
  return JSON.stringify({ game: clean }, null, 2);
}

export function createPlayers(names, startingPoints = 1000) {
  if (!Array.isArray(names)) throw new Error("Player names must be an array.");
  assertIntegerInRange(names.length, LIMITS.minPlayers, LIMITS.maxPlayers, "Player count");
  if (!Number.isInteger(startingPoints) || startingPoints < 1) throw new Error("Starting points must be a positive integer.");
  return names.map((name, index) => ({
    id: index,
    name: String(name).trim() || `Player ${index + 1}`,
    points: startingPoints,
    eliminated: false,
    wager: null,
    guess: "",
    graded: false,
  }));
}

export function setWager(player, amount) {
  if (player.eliminated) throw new Error(`${player.name} has been eliminated.`);
  if (!Number.isInteger(amount) || amount < 1 || amount > player.points) {
    throw new Error(`${player.name}'s wager must be from 1 to ${player.points}.`);
  }
  player.wager = amount;
  return player;
}

export function gradeBossGuess(player, correct) {
  if (player.eliminated) return player;
  if (!Number.isInteger(player.wager) || player.wager < 1) throw new Error(`${player.name} has no valid wager.`);
  player.points += correct ? player.wager : -player.wager;
  player.graded = true;
  if (player.points < 0) player.eliminated = true;
  return player;
}

export function adjustScore(player, delta) {
  if (!Number.isInteger(delta)) throw new Error("Score adjustment must be an integer.");
  player.points += delta;
  return player;
}

export function buzzTimer(deadline, now = Date.now()) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) throw new Error("Buzz timer values must be finite numbers.");
  const remainingMs = Math.max(0, deadline - now);
  const overtime = remainingMs <= 5_000;
  return {
    seconds: overtime ? Math.ceil(remainingMs / 1000) : Math.ceil((remainingMs - 5_000) / 1000),
    overtime,
    expired: remainingMs === 0,
  };
}

export function assertIntegerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}
