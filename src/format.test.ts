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

// 2025 Week 14, as returned by ESPN.
const lsu: Game = {
  id: '401752789',
  kickoff: '2025-11-29T20:30Z',
  timeValid: true,
  seasonType: 2,
  week: 14,
  headline: null,
  neutral: false,
  venue: 'Memorial Stadium, Norman, OK',
  spread: 'OU -12.5',
  overUnder: 36.5,
  home: { id: '201', name: 'Oklahoma', rank: 8, record: '9-2', score: 17, winner: true },
  away: { id: '99', name: 'LSU', rank: null, record: '7-5', score: 14, winner: false },
  networks: ['ABC'],
  state: 'post',
  completed: true,
};

// 2026 Week 2, OU ranked and on the road.
const michigan: Game = {
  ...lsu,
  kickoff: '2026-09-12T16:00Z',
  week: 2,
  venue: 'Michigan Stadium, Ann Arbor, MI',
  spread: 'OU -5.5',
  overUnder: 43.5,
  home: { id: '130', name: 'Michigan', rank: null, record: '1-0', score: null, winner: null },
  away: { id: '201', name: 'Oklahoma', rank: 11, record: '1-0', score: null, winner: null },
  networks: ['FOX'],
  state: 'pre',
  completed: false,
};

const noDetails: Game = {
  ...lsu,
  venue: null,
  spread: null,
  overUnder: null,
  home: { ...lsu.home, record: null },
  away: { ...lsu.away, record: null },
};

test('game thread title has no records, venue, or line', () => {
  assert.equal(gameThreadTitle(lsu), '[Week 14 Thread] LSU @ #8 Oklahoma');
  assert.equal(gameThreadTitle(michigan), '[Week 2 Thread] #11 Oklahoma @ Michigan');
});

test('neutral-site title uses vs', () => {
  const texas: Game = {
    ...lsu,
    week: 6,
    neutral: true,
    away: { id: '251', name: 'Texas', rank: 4, record: '4-1', score: null, winner: null },
    home: { ...lsu.home, rank: 11 },
  };
  assert.equal(gameThreadTitle(texas), '[Week 6 Thread] #4 Texas vs #11 Oklahoma');
});

test('game thread body with TBD links', () => {
  assert.equal(
    gameThreadBody(lsu, {}),
    [
      '# Game Thread',
      'Live Chat: TBD',
      'Postgame Thread: TBD',
      'LSU (7-5) @ #8 Oklahoma (9-2) - Memorial Stadium, Norman, OK',
      'Watch live on ABC - November 29th, 2:30PM CT',
      'Line: OU -12.5 | O/U 36.5',
      "LET'S TALK FOOTBALL!",
    ].join('\n\n'),
  );
});

test('links fill in once known', () => {
  const filled = gameThreadBody(lsu, { cfbGameThread: 'https://cfb', postgameThread: 'https://post' });
  assert.match(filled, /\n\nLive Chat: \[Link\]\(https:\/\/cfb\)\n\n/);
  assert.match(filled, /\n\nPostgame Thread: \[Link\]\(https:\/\/post\)\n\n/);
});

test('a matchup starting with a rank is escaped so it is not a heading', () => {
  assert.match(
    gameThreadBody(michigan, {}),
    /\n\n\\#11 Oklahoma \(1-0\) @ Michigan \(1-0\) - Michigan Stadium, Ann Arbor, MI\n\n/,
  );
});

test('missing records, venue, and line are left out cleanly', () => {
  assert.equal(
    gameThreadBody(noDetails, {}),
    [
      '# Game Thread',
      'Live Chat: TBD',
      'Postgame Thread: TBD',
      'LSU @ #8 Oklahoma',
      'Watch live on ABC - November 29th, 2:30PM CT',
      "LET'S TALK FOOTBALL!",
    ].join('\n\n'),
  );
});

test('line variations', () => {
  assert.match(gameThreadBody({ ...lsu, spread: 'EVEN' }, {}), /\n\nLine: Pick'em \| O\/U 36\.5\n\n/);
  assert.match(gameThreadBody({ ...lsu, spread: null }, {}), /\n\nLine: O\/U 36\.5\n\n/);
  assert.match(gameThreadBody({ ...lsu, overUnder: null }, {}), /\n\nLine: OU -12\.5\n\n/);
});

test('game details from an ESPN summary', () => {
  const summary = {
    header: {
      competitions: [
        {
          competitors: [
            { team: { id: '201' }, record: [{ type: 'total', summary: '9-2' }, { type: 'home', summary: '6-1' }] },
            { team: { id: '99' }, record: [{ type: 'total', summary: '7-5' }] },
          ],
        },
      ],
    },
    gameInfo: { venue: { fullName: 'Memorial Stadium (Norman, OK)', address: { city: 'Norman', state: 'OK' } } },
    pickcenter: [{ provider: { name: 'DraftKings' }, details: 'OU -12.5', overUnder: 36.5 }],
  };
  const game = applyGameDetails(noDetails, summary);
  assert.equal(game.venue, 'Memorial Stadium, Norman, OK');
  assert.equal(game.home.record, '9-2');
  assert.equal(game.away.record, '7-5');
  assert.equal(game.spread, 'OU -12.5');
  assert.equal(game.overUnder, 36.5);

  const empty = applyGameDetails(noDetails, {});
  assert.equal(empty.spread, null);
  assert.equal(empty.overUnder, null);
  assert.equal(empty.home.record, null);
});

test('kickoff times in Central, across daylight saving', () => {
  assert.equal(formatKickoff('2026-09-12T16:00Z'), 'September 12th, 11:00AM CT');
  assert.equal(formatKickoff('2025-11-29T20:30Z'), 'November 29th, 2:30PM CT');
  assert.equal(formatKickoff('2026-10-03T01:00Z'), 'October 2nd, 8:00PM CT');
  assert.equal(formatKickoff('2026-09-11T23:00Z'), 'September 11th, 6:00PM CT');
  assert.equal(formatKickoff('2026-11-21T17:00Z'), 'November 21st, 11:00AM CT');
  assert.equal(formatKickoff('2026-09-13T17:00Z'), 'September 13th, 12:00PM CT');
});

test('postgame when OU wins', () => {
  assert.equal(postgameTitle(lsu), '[Week 14 Postgame Thread] Oklahoma defeats LSU, 17-14');
  assert.equal(
    postgameBody(lsu),
    [
      '# Postgame Thread',
      'Please keep trash talk civil and report any comments that violate our rules.',
      'Boomer!',
    ].join('\n\n'),
  );
});

test('postgame when OU loses has no Boomer', () => {
  const loss: Game = {
    ...lsu,
    home: { ...lsu.home, score: 14, winner: false },
    away: { ...lsu.away, score: 17, winner: true },
  };
  assert.equal(postgameTitle(loss), '[Week 14 Postgame Thread] LSU defeats Oklahoma, 17-14');
  assert.doesNotMatch(postgameBody(loss), /Boomer/);
});

test('postseason label', () => {
  const cfp: Game = { ...lsu, seasonType: 3, week: 1, headline: 'College Football Playoff First Round Game' };
  assert.equal(gameThreadTitle(cfp), '[Postseason Thread] LSU @ #8 Oklahoma');
  assert.match(gameThreadBody(cfp, {}), /\n\nCollege Football Playoff First Round Game\n\nLSU \(7-5\)/);
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
