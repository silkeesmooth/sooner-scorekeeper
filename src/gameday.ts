import { context, reddit, redis, scheduler } from '@devvit/web/server';
import type { Post } from '@devvit/web/server';
import { fetchLiveGame, fetchSchedule, withGameDetails, type Game } from './espn.ts';
import {
  formatKickoff,
  gameThreadBody,
  gameThreadTitle,
  isCfbOuGameThread,
  postgameBody,
  postgameTitle,
} from './format.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const POST_BEFORE_KICKOFF = HOUR;
/** Games almost never end sooner than this, so ESPN isn't polled for a final until then. */
const CHECK_FINAL_AFTER = 2.5 * HOUR;
const GIVE_UP_AFTER = 12 * HOUR;
/** How far before kickoff an r/CFB game thread can have been posted and still count. */
const CFB_THREAD_WINDOW = 6 * HOUR;

type T3 = `t3_${string}`;

/**
 * Redis layout:
 *   game:<espnId>  hash of GameState
 *   active         ESPN id of the game whose postgame thread is still pending
 *   stickied       JSON list of post ids this app has stickied
 */
type GameState = {
  jobId?: string;
  runAt?: string;
  claimed?: string;
  gameThreadId?: string;
  snapshot?: string;
  cfbUrl?: string;
  postgameClaimed?: string;
  postgameThreadId?: string;
  postgameUrl?: string;
};

const gameKey = (eventId: string) => `game:${eventId}`;
const readState = async (eventId: string) => (await redis.hGetAll(gameKey(eventId))) as GameState;
const postUrl = (post: Post) =>
  post.permalink.startsWith('http') ? post.permalink : `https://www.reddit.com${post.permalink}`;

function subredditName(): string {
  const name = context.subredditName;
  if (!name) throw new Error('No subreddit in context');
  return name;
}

/**
 * Finds OU's next game and makes sure its game thread is scheduled for an hour before kickoff.
 * Runs every few hours so kickoff time announcements and changes get picked up.
 */
export async function syncSchedule(): Promise<string> {
  const now = Date.now();
  const next = (await fetchSchedule()).find((g) => !g.completed && Date.parse(g.kickoff) > now);
  if (!next) return 'No upcoming OU games found on ESPN.';

  const title = gameThreadTitle(next);
  const state = await readState(next.id);
  if (state.gameThreadId) return `Game thread for ${title} is already posted.`;

  if (!next.timeValid) {
    await cancelScheduledPost(next.id, state);
    return `Next game: ${title}. Kickoff time is still TBA; it will be scheduled once ESPN has a time.`;
  }

  const runAt = new Date(Date.parse(next.kickoff) - POST_BEFORE_KICKOFF);
  if (runAt.getTime() <= now) {
    await postGameThread(next.id);
    return `Posted the game thread for ${title}.`;
  }
  const postingAt = `${title} will post ${formatKickoff(runAt.toISOString())}.`;
  if (state.jobId && state.runAt === runAt.toISOString()) return postingAt;

  await cancelScheduledPost(next.id, state);
  const jobId = await scheduler.runJob({ name: 'post-game-thread', data: { eventId: next.id }, runAt });
  await redis.hSet(gameKey(next.id), { jobId, runAt: runAt.toISOString() });
  return postingAt;
}

async function cancelScheduledPost(eventId: string, state: GameState): Promise<void> {
  if (!state.jobId) return;
  await scheduler.cancelJob(state.jobId).catch((error) => console.warn(`Couldn't cancel job ${state.jobId}`, error));
  await redis.hDel(gameKey(eventId), ['jobId', 'runAt']);
}

export async function postGameThread(eventId: string): Promise<void> {
  const scheduled = (await fetchSchedule()).find((g) => g.id === eventId);
  if (!scheduled || scheduled.completed) return;

  if (!scheduled.timeValid || Date.parse(scheduled.kickoff) - POST_BEFORE_KICKOFF > Date.now() + 5 * MINUTE) {
    // Kickoff moved since this job was scheduled; reschedule rather than post early.
    await redis.hDel(gameKey(eventId), ['jobId', 'runAt']);
    console.log(await syncSchedule());
    return;
  }

  // Guards against the scheduled job and a schedule sync both posting.
  if (!(await redis.hSetNX(gameKey(eventId), 'claimed', '1'))) return;
  const game = await withGameDetails(scheduled);
  let post: Post;
  try {
    post = await reddit.submitPost({
      subredditName: subredditName(),
      title: gameThreadTitle(game),
      text: gameThreadBody(game, {}),
    });
  } catch (error) {
    await redis.hDel(gameKey(eventId), ['claimed']);
    throw error;
  }
  await redis.hSet(gameKey(eventId), { gameThreadId: post.id, snapshot: JSON.stringify(game) });
  await redis.set('active', eventId);
  console.log(`Posted game thread ${post.id} for ${gameThreadTitle(game)}`);

  await markAsMod(post);
  await unstickyPrevious();
  await stickyAndRemember(post);
  await linkCfbThread(eventId, game);
}

/**
 * Runs every couple of minutes. Does nothing unless a game thread is up and its postgame
 * thread hasn't been posted yet.
 */
export async function watchActiveGame(): Promise<void> {
  const eventId = await redis.get('active');
  if (!eventId) return;
  const state = await readState(eventId);
  if (!state.snapshot) {
    await redis.del('active');
    return;
  }
  const game = JSON.parse(state.snapshot) as Game;

  if (!state.cfbUrl) await linkCfbThread(eventId, game);

  const sinceKickoff = Date.now() - Date.parse(game.kickoff);
  if (sinceKickoff < CHECK_FINAL_AFTER) return;

  const live = await fetchLiveGame(eventId);
  if (live.completed) {
    await postPostgameThread(eventId, {
      ...game,
      home: { ...game.home, score: live.home.score, winner: live.home.winner },
      away: { ...game.away, score: live.away.score, winner: live.away.winner },
    });
  } else if (live.state === 'post' || sinceKickoff > GIVE_UP_AFTER) {
    // Postponed, canceled, or ESPN never marked it final.
    console.warn(`Game ${eventId} ended without a final score; skipping the postgame thread.`);
    await redis.del('active');
  }
}

async function linkCfbThread(eventId: string, game: Game): Promise<void> {
  const since = Date.parse(game.kickoff) - CFB_THREAD_WINDOW;
  const posts = await reddit.getNewPosts({ subredditName: 'CFB', limit: 100 }).all();
  const match = posts
    .filter((p) => p.createdAt.getTime() >= since && isCfbOuGameThread(p.title))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  if (!match) return;

  await redis.hSet(gameKey(eventId), { cfbUrl: postUrl(match) });
  console.log(`Linked r/CFB game thread ${match.id}`);
  await refreshGameThread(eventId);
}

async function postPostgameThread(eventId: string, game: Game): Promise<void> {
  if (!(await redis.hSetNX(gameKey(eventId), 'postgameClaimed', '1'))) return;
  let post: Post;
  try {
    post = await reddit.submitPost({
      subredditName: subredditName(),
      title: postgameTitle(game),
      text: postgameBody(game),
    });
  } catch (error) {
    await redis.hDel(gameKey(eventId), ['postgameClaimed']);
    throw error;
  }
  await redis.hSet(gameKey(eventId), { postgameThreadId: post.id, postgameUrl: postUrl(post) });
  await redis.del('active');
  console.log(`Posted postgame thread ${post.id}: ${postgameTitle(game)}`);

  await markAsMod(post);
  await stickyAndRemember(post);
  await refreshGameThread(eventId);
}

/** Rewrites the game thread body with whichever links are known so far. */
async function refreshGameThread(eventId: string): Promise<void> {
  const state = await readState(eventId);
  if (!state.gameThreadId || !state.snapshot) return;
  const post = await reddit.getPostById(state.gameThreadId as T3);
  await post.edit({
    text: gameThreadBody(JSON.parse(state.snapshot) as Game, {
      cfbGameThread: state.cfbUrl,
      postgameThread: state.postgameUrl,
    }),
  });
}

/** Distinguishes the post as a mod post (the green [M]). */
async function markAsMod(post: Post): Promise<void> {
  try {
    await post.distinguish();
  } catch (error) {
    console.error(`Couldn't distinguish ${post.id}`, error);
  }
}

const stickiedIds = async (): Promise<string[]> => JSON.parse((await redis.get('stickied')) ?? '[]');

/** Clears last week's game and postgame threads out of the sticky slots. */
async function unstickyPrevious(): Promise<void> {
  for (const id of await stickiedIds()) {
    try {
      await (await reddit.getPostById(id as T3)).unsticky();
    } catch (error) {
      console.warn(`Couldn't unsticky ${id}`, error);
    }
  }
  await redis.set('stickied', '[]');
}

async function stickyAndRemember(post: Post): Promise<void> {
  try {
    await post.sticky();
  } catch (error) {
    console.error(`Couldn't sticky ${post.id}`, error);
    return;
  }
  await redis.set('stickied', JSON.stringify([...(await stickiedIds()), post.id]));
}

/** Posts unstickied, untracked [TEST] copies of both thread types so mods can check formatting. */
export async function postTestThreads(): Promise<string> {
  const games = await fetchSchedule();
  const now = Date.now();
  const upcoming = games.find((g) => !g.completed && g.timeValid && Date.parse(g.kickoff) > now);
  const last = games.filter((g) => g.completed).at(-1);
  const posted: string[] = [];
  if (upcoming) {
    const game = await withGameDetails(upcoming);
    const title = `[TEST] ${gameThreadTitle(game)}`;
    await markAsMod(await reddit.submitPost({ subredditName: subredditName(), title, text: gameThreadBody(game, {}) }));
    posted.push(title);
  }
  if (last) {
    const title = `[TEST] ${postgameTitle(last)}`;
    await markAsMod(await reddit.submitPost({ subredditName: subredditName(), title, text: postgameBody(last) }));
    posted.push(title);
  }
  return posted.length ? `Posted: ${posted.join(' | ')}` : 'No games found to test with.';
}
