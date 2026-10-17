import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesAnswer } from '../core.mjs';
import { isPossibleTypo, needsTypoConfirmation } from '../answer-check.mjs';
const clue = (answer, accepted_answers = []) => ({ answer, accepted_answers });

test('acceptance ignores case and spacing but requires an explicit alternative for different number forms', () => {
  const king = clue('Henry VIII', ['Henry the 8th']);
  for (const value of ['henry viii', ' HENRY   VIII ', 'henry the 8th']) assert.equal(matchesAnswer(king, value), true);
  for (const value of ['Henry VII', 'Henry the 7th', 'Henry 8']) assert.equal(matchesAnswer(king, value), false);
  assert.equal(matchesAnswer(clue('C++'), 'C#'), false);
  assert.equal(matchesAnswer(clue('-10'), '10'), false);
});

test('one typo in one long word offers review, never automatic acceptance', () => {
  const planet = clue('Saturn', ['The ringed planet']);
  for (const value of ['Satrun', 'Satun', 'Saturnn', 'Saturr', 'The ringde planet']) {
    assert.equal(isPossibleTypo(planet, value), true, value);
    assert.equal(matchesAnswer(planet, value), false, value);
  }
  for (const value of ['Saturn', 'Jupiter', 'Satrun planet', 'Satrnn']) assert.equal(isPossibleTypo(planet, value), false, value);
});

test('meaning-changing numbers, symbols, short names, negation and word boundaries do not trigger typo hints', () => {
  for (const [answer, submitted] of [
    ['Henry VIII', 'Henry VII'], ['Henry the 8th', 'Henry the 7th'], ['1984', '1985'],
    ['Henry XVIII', 'Henry XVII'], ['one hundred', 'one hunderd'], ['twelve', 'twelwe'],
    ['Iran', 'Iraq'], ['Monet', 'Manet'], ['C++', 'C#'], ['-10', '10'],
    ['not Saturn', 'Saturn'], ['Australia', 'Austria'], ['New York', 'NewYork'],
  ]) assert.equal(isPossibleTypo(clue(answer), submitted), false, `${submitted} / ${answer}`);
});

test('only one spelling hint is available; retries require explicit confirmation', () => {
  const attempt = {};
  const planet = clue('Saturn');
  assert.equal(needsTypoConfirmation(attempt, planet, 'Satrun', false), true);
  assert.equal(needsTypoConfirmation(attempt, planet, 'Satrun', false), true);
  assert.equal(needsTypoConfirmation(attempt, planet, 'Satrun', true), false);
  assert.equal(needsTypoConfirmation(attempt, planet, 'Saturnn', false), false);
  assert.equal(needsTypoConfirmation(attempt, planet, 'Saturn', false), false);
});
