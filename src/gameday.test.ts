import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Game, Team } from './espn.ts';
import { eligibleGames } from './gameday.ts';

const NOW = Date.parse('2026-09-26T18:00:00Z');
const HOUR = 3_600_000;
const team = (id: string): Team => ({ id, name: id, rank: null, record: null, score: null, winner: null, linescores: [] });

// Minimal Game with an offset (hours from NOW) for kickoff.
function game(id: string, hoursFromNow: number, over: Partial<Game> = {}): Game {
  const kickoff = new Date(NOW + hoursFromNow * HOUR).toISOString();
  return {
    id,
    espnUrl: `https://e/${id}`,
    kickoff,
    timeValid: true,
    seasonType: 2,
    week: 5,
    headline: null,
    neutral: false,
    venue: null,
    spread: null,
    overUnder: null,
    home: team('OU'),
    away: team('OPP'),
    networks: [],
    state: 'pre',
    completed: false,
    ...over,
  };
}

test('keeps a future game', () => {
  assert.deepEqual(eligibleGames([game('future', 3)], NOW).map((g) => g.id), ['future']);
});

test('excludes a completed game', () => {
  assert.deepEqual(eligibleGames([game('done', -5, { completed: true })], NOW), []);
});

test('keeps an in-progress game whose kickoff moved earlier (under 3h ago)', () => {
  // The whole point of the earlier-move fix: a game already under way, not yet posted, stays eligible.
  assert.deepEqual(eligibleGames([game('live', -1)], NOW).map((g) => g.id), ['live']);
});

test('excludes a game that started more than 3h ago (missed)', () => {
  assert.deepEqual(eligibleGames([game('stale', -4)], NOW), []);
});

test('keeps a TBA game regardless of its placeholder date', () => {
  // ESPN gives TBA games a placeholder date that can be in the past; the missed rule must not drop them.
  assert.deepEqual(eligibleGames([game('tba', -6, { timeValid: false })], NOW).map((g) => g.id), ['tba']);
});

test('returns eligible games in the order given (earliest first)', () => {
  const games = [game('a', -1), game('b', 2), game('c', 24), game('old', -10)];
  assert.deepEqual(eligibleGames(games, NOW).map((g) => g.id), ['a', 'b', 'c']);
});
