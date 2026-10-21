import { matchesAnswer, normalizeAnswer } from './core.mjs';

// These tokens can change meaning with a single character. Never fuzzy-match them.
const protectedWords = new Set(('no not never without except neither nor zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty first second third fourth fifth sixth seventh eighth ninth tenth hundred thousand million billion').split(' '));
const romanNumeral = /^[ivxlcdm]+$/;

function oneTypo(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1)
      || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export function isPossibleTypo(clue, answer) {
  if (matchesAnswer(clue, answer)) return false;
  const submitted = normalizeAnswer(answer).split(' ');
  return [clue.answer, ...clue.accepted_answers].some(candidate => {
    const expected = normalizeAnswer(candidate).split(' ');
    if (submitted.length !== expected.length) return false;
    const differences = submitted.map((word, index) => [word, expected[index]]).filter(([a, b]) => a !== b);
    if (differences.length !== 1) return false;
    const [a, b] = differences[0];
    // One edit in one long alphabetic word only. Numbers, symbols, short names,
    // Roman numerals, and changed word boundaries require host judgment.
    if (!/^[a-z]{5,}$/.test(a) || !/^[a-z]{5,}$/.test(b) || Math.max(a.length, b.length) < 6) return false;
    if ([a, b].some(word => protectedWords.has(word) || romanNumeral.test(word))) return false;
    return oneTypo(a, b);
  });
}

// At most one spelling hint per player attempt. Repeat requests for the same
// draft repeat the prompt until explicitly confirmed; they cannot lock it by accident.
export function needsTypoConfirmation(attempt, clue, answer, confirmed) {
  if (matchesAnswer(clue, answer) || confirmed === true) return false;
  if (attempt.typo_warning_answer === answer) return true;
  if (attempt.typo_checked) return false;
  attempt.typo_checked = true;
  if (!isPossibleTypo(clue, answer)) return false;
  attempt.typo_warning_answer = answer;
  return true;
}
