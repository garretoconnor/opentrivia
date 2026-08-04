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

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createClue(row) {
  return { value: (row + 1) * 200, answer: "", question: "" };
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
    columns: [{ topic: "Boss topic", size: 1, clues: [{ value: 0, answer: "", question: "" }] }],
  };
}

export function createGame() {
  const boards = [createBoard()];
  return { name: "Untitled game", num_players: LIMITS.defaultPlayers, size: boards.length, boards };
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

  return {
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
        clues: column.clues.map((clue, clueIndex) => normalizeClue(clue, `${path}.clues[${clueIndex}]`)),
      };
    }),
  };
}

function normalizeClue(clue, path) {
  if (!isObject(clue)) throw new Error(`${path} must be an object.`);
  if (!Number.isInteger(clue.value)) throw new Error(`${path}.value must be an integer.`);
  if (typeof clue.answer !== "string") throw new Error(`${path}.answer must be a string.`);
  if (typeof clue.question !== "string") throw new Error(`${path}.question must be a string.`);
  return { value: clue.value, answer: clue.answer, question: clue.question };
}

export function normalizeGame(input) {
  const game = isObject(input) && "game" in input ? input.game : input;
  if (!isObject(game)) throw new Error("game must be an object.");
  if (typeof game.name !== "string") throw new Error("game.name must be a string.");
  assertIntegerInRange(game.num_players, LIMITS.minPlayers, LIMITS.maxPlayers, "game.num_players");
  if (!Number.isInteger(game.size) || game.size < 1) throw new Error("game.size must be an integer of at least 1.");
  if (!Array.isArray(game.boards)) throw new Error("game.boards must be an array.");
  if (game.boards.length !== game.size) throw new Error(`game.boards must contain exactly ${game.size} boards.`);
  return {
    name: game.name,
    num_players: game.num_players,
    size: game.size,
    boards: game.boards.map((board, index) => normalizeBoard(board, `game.boards[${index}]`)),
  };
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

export function assertIntegerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}
