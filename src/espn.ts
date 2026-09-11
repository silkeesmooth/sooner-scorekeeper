// ESPN's public site API. site.api.espn.com is on Devvit's global fetch allowlist.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
export const OU_TEAM_ID = '201';

export type Team = {
  id: string;
  name: string;
  /** AP poll until CFP rankings are released, then CFP (ESPN's "curated" rank). */
  rank: number | null;
  /** Overall record, e.g. "1-0". Filled in by withGameDetails. */
  record: string | null;
  score: number | null;
  winner: boolean | null;
};

export type Game = {
  id: string;
  kickoff: string;
  /** False while the kickoff time is still TBA. */
  timeValid: boolean;
  /** 2 = regular season, 3 = postseason. */
  seasonType: number;
  week: number | null;
  /** e.g. "College Football Playoff First Round Game" for postseason games. */
  headline: string | null;
  neutral: boolean;
  /** e.g. "Michigan Stadium, Ann Arbor, MI" */
  venue: string | null;
  /** Favorite and spread as ESPN writes it, e.g. "OU -5.5" or "EVEN". Filled in by withGameDetails. */
  spread: string | null;
  overUnder: number | null;
  home: Team;
  away: Team;
  networks: string[];
  state: 'pre' | 'in' | 'post';
  completed: boolean;
};

// ESPN's JSON is large and loosely structured, so it is read defensively.
type Json = any;

async function getJson(url: string): Promise<Json> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN request failed (${res.status}): ${url}`);
  return res.json();
}

const fetchSummary = (eventId: string) => getJson(`${BASE}/summary?event=${encodeURIComponent(eventId)}`);

function parseRecord(records: Json): string | null {
  if (!Array.isArray(records)) return null;
  const total = records.find((r) => r.type === 'total') ?? records[0];
  return total?.summary ?? total?.displayValue ?? null;
}

function parseVenue(venue: Json): string | null {
  if (!venue?.fullName) return null;
  // ESPN sometimes puts the city in the name, e.g. "Memorial Stadium (Norman, OK)".
  const name = String(venue.fullName).replace(/\s*\(.*\)$/, '');
  const { city, state } = venue.address ?? {};
  return city && state ? `${name}, ${city}, ${state}` : name;
}

function parseTeam(c: Json): Team {
  const rank = Number(c.curatedRank?.current ?? c.rank);
  const rawScore = typeof c.score === 'object' ? c.score?.displayValue : c.score;
  const score = rawScore === undefined || rawScore === null ? NaN : Number(rawScore);
  return {
    id: String(c.team?.id ?? c.id),
    name: c.team?.location ?? c.team?.shortDisplayName ?? 'TBD',
    rank: rank >= 1 && rank <= 25 ? rank : null,
    record: parseRecord(c.record ?? c.records),
    score: Number.isFinite(score) ? score : null,
    winner: typeof c.winner === 'boolean' ? c.winner : null,
  };
}

function parseNetworks(broadcasts: Json[] = []): string[] {
  const named = (type: string) =>
    broadcasts
      .filter((b) => b.type?.shortName === type)
      .map((b) => String(b.media?.shortName ?? ''))
      .filter(Boolean);
  const tv = named('TV');
  return [...new Set(tv.length ? tv : named('Streaming'))];
}

export function parseGame(event: Json, comp: Json = event.competitions?.[0]): Game {
  const competitors: Json[] = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) throw new Error(`ESPN event ${event.id} is missing a home or away team`);
  const status = comp.status?.type ?? {};
  return {
    id: String(event.id ?? comp.id),
    kickoff: comp.date ?? event.date,
    timeValid: (comp.timeValid ?? event.timeValid ?? comp.dateValid) !== false,
    seasonType: Number(event.seasonType?.type ?? 2),
    week: typeof event.week?.number === 'number' ? event.week.number : null,
    headline: comp.notes?.[0]?.headline ?? null,
    neutral: comp.neutralSite === true,
    venue: parseVenue(comp.venue),
    spread: null,
    overUnder: null,
    home: parseTeam(home),
    away: parseTeam(away),
    networks: parseNetworks(comp.broadcasts),
    state: status.state ?? 'pre',
    completed: status.completed === true,
  };
}

/** Adds the betting line, team records, and venue from an ESPN game summary. */
export function applyGameDetails(game: Game, summary: Json): Game {
  const competitors: Json[] = summary.header?.competitions?.[0]?.competitors ?? [];
  const withRecord = (team: Team): Team => {
    const c = competitors.find((x) => String(x.team?.id ?? x.id) === team.id);
    return { ...team, record: parseRecord(c?.record) ?? team.record };
  };
  const pick = summary.pickcenter?.[0];
  const spread = typeof pick?.details === 'string' ? pick.details.trim() : '';
  return {
    ...game,
    home: withRecord(game.home),
    away: withRecord(game.away),
    venue: parseVenue(summary.gameInfo?.venue) ?? game.venue,
    spread: spread || null,
    overUnder: typeof pick?.overUnder === 'number' ? pick.overUnder : null,
  };
}

/** Like applyGameDetails, but fetches the summary. Falls back to the plain game if ESPN fails. */
export async function withGameDetails(game: Game): Promise<Game> {
  try {
    return applyGameDetails(game, await fetchSummary(game.id));
  } catch (error) {
    console.warn(`Couldn't load game details for ${game.id}; posting without them.`, error);
    return game;
  }
}

/** OU's regular season and postseason games for the current season. */
export async function fetchSchedule(): Promise<Game[]> {
  const url = `${BASE}/teams/${OU_TEAM_ID}/schedule`;
  const [regular, post] = await Promise.all([
    getJson(url),
    getJson(`${url}?seasontype=3`).catch(() => ({ events: [] })),
  ]);
  return [...(regular.events ?? []), ...(post.events ?? [])]
    .map((e: Json) => parseGame(e))
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
}

/** Live status and score for one game. */
export async function fetchLiveGame(eventId: string): Promise<Game> {
  const summary = await fetchSummary(eventId);
  return parseGame({ ...summary.header, id: eventId }, summary.header?.competitions?.[0]);
}
