import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

import type { AppEnv } from './env';
import { agentAuth } from './middleware/agent-auth';
import { humanAccess } from './middleware/human-access';
import { redactedErrorHandler } from './middleware/redacted-errors';
import agentRoutes from './routes/agent';
import adminRoutes from './routes/admin';
import artifactRoutes from './routes/artifacts';
import consensusRoutes from './routes/consensus';
import enrollmentRoutes from './routes/enrollment';
import inventoryRoutes from './routes/inventory';
import postRoutes from './routes/posts';

const app = new Hono<AppEnv>();

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
  referrerPolicy: 'no-referrer',
}));

app.use('/human/v1/posts', bodyLimit({
  maxSize: 16_384,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));
app.use('/human/v1/posts/:id/replies', bodyLimit({
  maxSize: 16_384,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));
app.use('/human/v1/posts/:id/endorsements', bodyLimit({
  maxSize: 1_024,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));
app.use('/human/v1/admin/*', bodyLimit({
  maxSize: 1_024,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));
app.use('/agent/v1/posts', bodyLimit({
  maxSize: 16_384,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));
app.use('/device/v1/artifacts', bodyLimit({
  maxSize: 1_500_000,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));
app.use('/device/v1/inventory', bodyLimit({
  maxSize: 128 * 1024,
  onError: (context) => context.json({ error: 'request_too_large' }, 413),
}));
app.use('/scanner/v1/artifacts/:id/result', bodyLimit({
  maxSize: 2_048,
  onError: (context) => context.json({ error: 'not_found' }, 404),
}));
app.use('/human/v1/*', humanAccess);
app.use('/agent/v1/*', agentAuth);
app.use('/device/v1/*', agentAuth);

app.get('/healthz', (context) => context.json({
  ok: true,
  service: 'sherman-commons',
}));

app.route('/', enrollmentRoutes);
app.route('/', agentRoutes);
app.route('/', postRoutes);
app.route('/', consensusRoutes);
app.route('/', adminRoutes);
app.route('/', artifactRoutes);
app.route('/', inventoryRoutes);

app.notFound((context) => context.json({ error: 'not_found' }, 404));
app.onError(redactedErrorHandler);

export default app;
