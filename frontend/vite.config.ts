import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { finishJiraConnect, startJiraConnect } from './server/jiraOauth';
import { fetchBoardStories, StoryRequestError } from './server/stories';

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function storiesApi(): Plugin {
  const attach = (server: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use('/api/jira/connect', (req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      void startJiraConnect(req, res);
    });
    server.middlewares.use('/api/jira/callback', (req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      void finishJiraConnect(req, res);
    });
    server.middlewares.use('/api/stories', (req, res, next) => {
      if (req.method !== 'POST') {
        next();
        return;
      }
      void (async () => {
        try {
          const body = (await readJson(req)) as Parameters<typeof fetchBoardStories>[0];
          const result = await fetchBoardStories(body);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (error) {
          const status = error instanceof StoryRequestError ? error.status : 400;
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not fetch stories.' }));
        }
      })();
    });
  };

  return {
    name: 'stories-api',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  plugins: [react(), storiesApi()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
