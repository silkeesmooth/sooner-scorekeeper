// All post titles and bodies live here — edit this file to change the wording.
import { RichTextBuilder } from '@devvit/web/server';
import { makeFormatting } from '@devvit/shared-types/richtext/elements.js';
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

const linkOrTba = (url: string | undefined) => (url ? `[Link](${url})` : '**TBA**');

/** "Watch live on **[FOX](url)** — November 29th, 2:30PM CT" */
function watchLine(game: Game): string {
  const kickoff = formatKickoff(game.kickoff);
  if (!game.networks.length) return `**Kickoff:** ${kickoff}`;
  return `**Watch live on [${game.networks.join('/')}](${game.espnUrl})** — ${kickoff}`;
}

/** "**Line:** OU -5.5 | O/U 43.5", or null when ESPN has no line. */
function bettingLine(game: Game): string | null {
  const parts = [
    game.spread && (/^even$/i.test(game.spread) ? "Pick'em" : game.spread),
    typeof game.overUnder === 'number' ? `O/U ${game.overUnder}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `**Line:** ${parts.join(' | ')}` : null;
}

export function gameThreadBody(game: Game, links: ThreadLinks): string {
  const linksBlock = `Live Chat: ${linkOrTba(links.cfbGameThread)}  \nPostgame Thread: ${linkOrTba(links.postgameThread)}`;
  const line = bettingLine(game);
  return [
    linksBlock,
    ...(game.headline ? [`*${game.headline}*`] : []),
    watchLine(game),
    ...(line ? [line] : []),
    "# LET'S TALK FOOTBALL!",
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

/** Header labels for the periods played: 1-4, then OT, 2OT, ... */
function periodLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i < 4 ? String(i + 1) : i === 4 ? 'OT' : `${i - 3}OT`));
}

const italic = (text: string) => ({ text, formatting: [makeFormatting({ italic: true, startIndex: 0, length: text.length })] });

/**
 * Builds the postgame body as richtext, NOT markdown. Reddit's markdown-to-richtext
 * conversion in submitPost({ text }) rejects tables ("META_RTJSON_MALFORMED"), so the
 * table is built with RichTextBuilder, which submitPost({ richtext }) accepts natively.
 *
 * Layout (away team first, matching the title):
 *   | | 1 | 2 | 3 | 4 | Final |   <- score-by-quarter table
 *   *Box Score provided by ESPN.*
 *   *Please keep trash talk civil ...*
 *   # Boomer!                       <- only when OU wins
 */
export function postgameRichtext(game: Game): RichTextBuilder {
  const builder = new RichTextBuilder();
  const periods = Math.max(game.away.linescores.length, game.home.linescores.length);

  if (periods > 0) {
    const labels = periodLabels(periods);
    builder.table((table) => {
      table.headerCell({ columnAlignment: 'left' }, (c) => c.text({ text: '' }));
      for (const label of labels) table.headerCell({ columnAlignment: 'center' }, (c) => c.text({ text: label }));
      table.headerCell({ columnAlignment: 'center' }, (c) => c.text({ text: 'Final' }));
      for (const team of [game.away, game.home]) {
        table.row((r) => {
          r.cell((c) => c.text({ text: teamWithRank(team) }));
          for (let i = 0; i < labels.length; i++) r.cell((c) => c.text({ text: String(team.linescores[i] ?? '') }));
          const final = String(team.score ?? 0);
          r.cell((c) => c.text({ text: final, formatting: [makeFormatting({ bold: true, startIndex: 0, length: final.length })] }));
        });
      }
    });
  } else {
    // Fallback when ESPN gave no per-quarter data.
    const [winner, loser] = winnerAndLoser(game);
    builder.paragraph((p) =>
      p.text({ text: `Final: ${winner.name} ${winner.score ?? 0}, ${loser.name} ${loser.score ?? 0}` }),
    );
  }

  builder.paragraph((p) => {
    p.text(italic('Box Score provided by '));
    p.link({ text: 'ESPN', url: game.espnUrl, formatting: [makeFormatting({ italic: true, startIndex: 0, length: 4 })] });
    p.text(italic('.'));
  });
  builder.paragraph((p) =>
    p.text(italic('Please keep trash talk civil and report any comments that violate our rules.')),
  );
  if (ouWon(game)) builder.heading({ level: 1 }, (h) => h.rawText('Boomer!'));

  return builder;
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
