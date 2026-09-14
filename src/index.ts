import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { postGameThread, syncSchedule, watchActiveGame } from './gameday.ts';

const app = new Hono();

// Scheduled tasks (see "scheduler" in devvit.json).
app.post('/internal/scheduler/sync-schedule', async (c) => {
  console.log(await syncSchedule());
  return c.json<TaskResponse>({}, 200);
});

app.post('/internal/scheduler/watch-game', async (c) => {
  await watchActiveGame();
  return c.json<TaskResponse>({}, 200);
});

app.post('/internal/scheduler/post-game-thread', async (c) => {
  const { data } = await c.req.json<TaskRequest<{ eventId: string }>>();
  await postGameThread(data.eventId);
  return c.json<TaskResponse>({}, 200);
});

// Schedule the next game as soon as the app is installed or updated.
for (const trigger of ['on-app-install', 'on-app-upgrade']) {
  app.post(`/internal/triggers/${trigger}`, async (c) => {
    console.log(await syncSchedule());
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  });
}

// Moderator menu items on the subreddit.
const toast = async (action: () => Promise<string>): Promise<UiResponse> => {
  try {
    return { showToast: await action() };
  } catch (error) {
    console.error(error);
    return { showToast: `Failed: ${error instanceof Error ? error.message : String(error)}` };
  }
};

app.post('/internal/menu/sync', async (c) => c.json<UiResponse>(await toast(syncSchedule), 200));

app.onError((error, c) => {
  console.error(`${c.req.path} failed:`, error);
  return c.json({ error: String(error) }, 500);
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
