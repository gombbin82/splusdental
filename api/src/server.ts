import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: createApp().fetch, port });
console.log(JSON.stringify({ severity: 'INFO', message: `api listening on ${port}` }));
