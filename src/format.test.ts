import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGameDetails, type Game } from './espn.ts';
import {
  formatKickoff,
  gameThreadBody,
  gameThreadTitle,
  isCfbOuGameThread,
  postgameBody,
  postgameTitle,
} from './format.ts';

const ESPN = 'https://www.espn.com/college-football/game/_/gameId/401752789';

// 2025 Week 14 (OU 17, LSU 14), with per-quarter scores.
const lsu: Game = {
  id: '401752789',
  espnUrl: ESPN,
  kickoff: '2025-11-29T20:30Z',
  timeValid: true,
  seasonType: 2,
  week: 14,
  headline: null,
  neutral: false,
  venue: 'Memorial Stadium, Norman, OK',
  spread: 'OU -12.5',
  overUnder: 36.5,
  home: { id: '201', name: 'Oklahoma', rank: 8, record: '9-2', score: 17, winner: true, linescores: [7, 3, 0, 7] },
  away: { id: '99', name: 'LSU', rank: null, record: '7-5', score: 14, winner: false, linescores: [0, 7, 7, 0] },
  networks: ['ABC'],
  state: 'post',
  completed: true,
};

// 2026 Week 2, OU ranked and on the road, pre-game (no scores yet).
const michigan: Game = {
  ...lsu,
  espnUrl: 'https://www.espn.com/college-football/game/_/gameId/401856679',
  kickoff: '2026-09-12T16:00Z',
  week: 2,
  spread: 'OU -5.5',
  overUnder: 43.5,
  home: { id: '130', name: 'Michigan', rank: null, record: '1-0', score: null, winner: null, linescores: [] },
  away: { id: '201', name: 'Oklahoma', rank: 11, record: '1-0', score: null, winner: null, linescores: [] },
  networks: ['FOX'],
  state: 'pre',
  completed: false,
};

test('game thread title unchanged, no records or venue', () => {
  assert.equal(gameThreadTitle(lsu), '[Week 14 Thread] LSU @ #8 Oklahoma');
  assert.equal(gameThreadTitle(michigan), '[Week 2 Thread] #11 Oklahoma @ Michigan');
});

test('neutral-site title uses vs', () => {
  const texas: Game = {
    ...lsu,
    week: 6,
    neutral: true,
    away: { id: '251', name: 'Texas', rank: 4, record: '4-1', score: null, winner: null, linescores: [] },
    home: { ...lsu.home, rank: 11 },
  };
  assert.equal(gameThreadTitle(texas), '[Week 6 Thread] #4 Texas vs #11 Oklahoma');
});

test('game thread body: no heading, TBA links, hyperlinked watch, no matchup line', () => {
  const body = gameThreadBody(michigan, {});
  assert.equal(
    body,
    [
      'Live Chat: **TBA**  \nPostgame Thread: **TBA**',
      '**Watch live on [FOX](https://www.espn.com/college-football/game/_/gameId/401856679)** — September 12th, 11:00AM CT',
      '**Line:** OU -5.5 | O/U 43.5',
      "# LET'S TALK FOOTBALL!",
    ].join('\n\n'),
  );
  assert.doesNotMatch(body, /# Game Thread/);
  assert.doesNotMatch(body, /TBD/);
  assert.doesNotMatch(body, /Oklahoma \(1-0\)/); // matchup/records line removed
});

test('links fill in once known, replacing TBA', () => {
  const filled = gameThreadBody(lsu, { cfbGameThread: 'https://cfb', postgameThread: 'https://post' });
  assert.match(filled, /Live Chat: \[Link\]\(https:\/\/cfb\)/);
  assert.match(filled, /Postgame Thread: \[Link\]\(https:\/\/post\)/);
  assert.doesNotMatch(filled, /\*\*TBA\*\*/);
});

test('no network falls back to a plain kickoff line', () => {
  assert.match(gameThreadBody({ ...michigan, networks: [] }, {}), /\*\*Kickoff:\*\* September 12th, 11:00AM CT/);
});

test('kickoff times in Central, across daylight saving', () => {
  assert.equal(formatKickoff('2026-09-12T16:00Z'), 'September 12th, 11:00AM CT');
  assert.equal(formatKickoff('2025-11-29T20:30Z'), 'November 29th, 2:30PM CT');
  assert.equal(formatKickoff('2026-10-03T01:00Z'), 'October 2nd, 8:00PM CT');
  assert.equal(formatKickoff('2026-11-21T17:00Z'), 'November 21st, 11:00AM CT');
});

test('postgame body: score table, ESPN attribution, italic rules, Boomer heading', () => {
  const body = postgameBody(lsu);
  assert.equal(
    body,
    [
      '| | 1 | 2 | 3 | 4 | Final |\n|:-|:-:|:-:|:-:|:-:|:-:|\n| LSU | 0 | 7 | 7 | 0 | **14** |\n| #8 Oklahoma | 7 | 3 | 0 | 7 | **17** |',
      `*Box Score provided by [ESPN](${ESPN}).*`,
      '*Please keep trash talk civil and report any comments that violate our rules.*',
      '# Boomer!',
    ].join('\n\n'),
  );
  assert.doesNotMatch(body, /# Postgame Thread/);
});

test('postgame when OU loses: loser-first title, no Boomer', () => {
  const loss: Game = {
    ...lsu,
    home: { ...lsu.home, score: 10, winner: false, linescores: [0, 0, 7, 3] },
    away: { ...lsu.away, name: 'Michigan', score: 17, winner: true, linescores: [7, 3, 0, 7] },
  };
  assert.equal(postgameTitle(loss), '[Week 14 Postgame Thread] Michigan defeats Oklahoma, 17-10');
  assert.doesNotMatch(postgameBody(loss), /Boomer/);
});

test('overtime adds an OT column', () => {
  const ot: Game = {
    ...lsu,
    home: { ...lsu.home, score: 24, linescores: [7, 3, 0, 7, 7] },
    away: { ...lsu.away, score: 21, linescores: [0, 7, 7, 0, 7] },
  };
  const body = postgameBody(ot);
  assert.match(body, /\| \| 1 \| 2 \| 3 \| 4 \| OT \| Final \|/);
  assert.match(body, /\| #8 Oklahoma \| 7 \| 3 \| 0 \| 7 \| 7 \| \*\*24\*\* \|/);
});

test('postgame falls back to a final-score line without per-quarter data', () => {
  const noLines: Game = {
    ...lsu,
    home: { ...lsu.home, linescores: [] },
    away: { ...lsu.away, linescores: [] },
  };
  const body = postgameBody(noLines);
  assert.match(body, /\*\*Final:\*\* Oklahoma 17, LSU 14/);
  assert.doesNotMatch(body, /\| Final \|/);
});

test('postseason label and italicized headline', () => {
  const cfp: Game = { ...michigan, seasonType: 3, week: 1, headline: 'College Football Playoff First Round Game' };
  assert.equal(gameThreadTitle(cfp), '[Postseason Thread] #11 Oklahoma @ Michigan');
  assert.match(gameThreadBody(cfp, {}), /\n\n\*College Football Playoff First Round Game\*\n\n/);
});

test('game details from an ESPN summary preserve linescores', () => {
  const summary = {
    header: {
      competitions: [
        {
          competitors: [
            { team: { id: '201' }, record: [{ type: 'total', summary: '9-2' }] },
            { team: { id: '99' }, record: [{ type: 'total', summary: '7-5' }] },
          ],
        },
      ],
    },
    gameInfo: { venue: { fullName: 'Memorial Stadium (Norman, OK)', address: { city: 'Norman', state: 'OK' } } },
    pickcenter: [{ provider: { name: 'DraftKings' }, details: 'OU -12.5', overUnder: 36.5 }],
  };
  const game = applyGameDetails(lsu, summary);
  assert.equal(game.venue, 'Memorial Stadium, Norman, OK');
  assert.equal(game.home.record, '9-2');
  assert.equal(game.away.record, '7-5');
  assert.equal(game.home.linescores.length, 4); // preserved from the base game
  assert.equal(game.spread, 'OU -12.5');
});

test('r/CFB game thread matching', () => {
  assert.ok(isCfbOuGameThread('[Game Thread] LSU @ Oklahoma (3:30 PM ET)'));
  assert.ok(isCfbOuGameThread('[Game Thread] UTEP @ Oklahoma (8:00 PM ET)'));
  assert.ok(isCfbOuGameThread('[Game Thread] Texas vs. Oklahoma (2:30 PM ET)'));
  assert.ok(!isCfbOuGameThread('[Game Thread] Oklahoma State @ Tulsa (3:45 PM ET)'));
  assert.ok(!isCfbOuGameThread('[Game Thread] Alabama @ Oklahoma (8:00 PM ET) 2nd Half'));
  assert.ok(!isCfbOuGameThread('[Game Thread] CFP Rankings - Week 15'));
  assert.ok(!isCfbOuGameThread('[Postgame Thread] Oklahoma Defeats LSU 17-14'));
});
