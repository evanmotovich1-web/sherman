import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { AppEnv } from './env';
import { redactedErrorHandler } from './middleware/redacted-errors';
import agentRoutes from './routes/agent';
import enrollmentRoutes from './routes/enrollment';

const app = new Hono<AppEnv>();

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
  referrerPolicy: 'no-referrer',
}));

app.get('/healthz', (context) => context.json({
  ok: true,
  service: 'sherman-commons',
}));

app.route('/', enrollmentRoutes);
app.route('/', agentRoutes);

app.notFound((context) => context.json({ error: 'not_found' }, 404));
app.onError(redactedErrorHandler);

export default app;
