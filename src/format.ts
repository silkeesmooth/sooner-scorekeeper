// All post titles and bodies live here — edit this file to change the wording.
import type { Game, Team } from './espn.ts';

const OU_TEAM_ID = '201';

export type ThreadLinks = {
  cfbGameThread?: string | undefined;
  postgameThread?: string | undefined;
};

function threadLabel(game: Game): string {
  if (game.seasonType === 3 || game.week === null) return 'Postseason';
  return `Week ${game.week}`;
}

const separator = (game: Game) => (game.neutral ? 'vs' : '@');

function teamWithRank(team: Team): string {
  return team.rank ? `#${team.rank} ${team.name}` : team.name;
}

function teamWithRecord(team: Team): string {
  return team.record ? `${teamWithRank(team)} (${team.record})` : teamWithRank(team);
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/** "November 29th, 2:30PM CT" */
export function formatKickoff(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('month')} ${ordinal(Number(part('day')))}, ${part('hour')}:${part('minute')}${part('dayPeriod').toUpperCase()} CT`;
}

/** "[Week 14 Thread] LSU @ #8 Oklahoma" — "vs" instead of "@" at neutral sites. */
export function gameThreadTitle(game: Game): string {
  return `[${threadLabel(game)} Thread] ${teamWithRank(game.away)} ${separator(game)} ${teamWithRank(game.home)}`;
}

const linkOrTbd = (url: string | undefined) => (url ? `[Link](${url})` : 'TBD');

/** "#11 Oklahoma (1-0) @ Michigan (1-0) - Michigan Stadium, Ann Arbor, MI" */
function matchupLine(game: Game): string {
  const matchup = `${teamWithRecord(game.away)} ${separator(game)} ${teamWithRecord(game.home)}`;
  return game.venue ? `${matchup} - ${game.venue}` : matchup;
}

/** "Line: OU -5.5 | O/U 43.5", or null when ESPN has no line. */
function bettingLine(game: Game): string | null {
  const parts = [
    game.spread && (/^even$/i.test(game.spread) ? "Pick'em" : game.spread),
    typeof game.overUnder === 'number' ? `O/U ${game.overUnder}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `Line: ${parts.join(' | ')}` : null;
}

// A paragraph starting with "#" (like "#11 Oklahoma") renders as a heading on old Reddit.
const escapeLeadingHash = (paragraph: string) => paragraph.replace(/^#/, '\\#');

export function gameThreadBody(game: Game, links: ThreadLinks): string {
  const kickoff = formatKickoff(game.kickoff);
  const line = bettingLine(game);
  return [
    '# Game Thread',
    `Live Chat: ${linkOrTbd(links.cfbGameThread)}`,
    `Postgame Thread: ${linkOrTbd(links.postgameThread)}`,
    ...(game.headline ? [game.headline] : []),
    escapeLeadingHash(matchupLine(game)),
    game.networks.length ? `Watch live on ${game.networks.join('/')} - ${kickoff}` : `Kickoff: ${kickoff}`,
    ...(line ? [line] : []),
    "LET'S TALK FOOTBALL!",
  ].join('\n\n');
}

function winnerAndLoser(game: Game): [Team, Team] {
  const { home, away } = game;
  if (home.winner !== null && away.winner !== null && home.winner !== away.winner) {
    return home.winner ? [home, away] : [away, home];
  }
  return (home.score ?? 0) >= (away.score ?? 0) ? [home, away] : [away, home];
}

export function ouWon(game: Game): boolean {
  return winnerAndLoser(game)[0].id === OU_TEAM_ID;
}

/** "[Week 14 Postgame Thread] Oklahoma defeats LSU, 17-14" */
export function postgameTitle(game: Game): string {
  const [winner, loser] = winnerAndLoser(game);
  return `[${threadLabel(game)} Postgame Thread] ${winner.name} defeats ${loser.name}, ${winner.score ?? 0}-${loser.score ?? 0}`;
}

export function postgameBody(game: Game): string {
  return [
    '# Postgame Thread',
    'Please keep trash talk civil and report any comments that violate our rules.',
    ...(ouWon(game) ? ['Boomer!'] : []),
  ].join('\n\n');
}

/**
 * Matches r/CFB's main game thread for OU, e.g. "[Game Thread] LSU @ Oklahoma (3:30 PM ET)".
 * Skips Oklahoma State games and r/CFB's separate "2nd Half" threads.
 */
export function isCfbOuGameThread(title: string): boolean {
  return (
    /^\[Game Thread\]/i.test(title) &&
    /\bOklahoma\b(?!\s+State)/i.test(title) &&
    !/\b2nd Half\b/i.test(title)
  );
}
