import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import authRoutes from './routes/auth.js';
import presetRoutes from './routes/presets.js';
import projectRoutes from './routes/projects.js';
import wsRoutes from './ws/handler.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});

await app.register(websocket);

// Routes
await app.register(authRoutes);
await app.register(presetRoutes);
await app.register(projectRoutes);
await app.register(wsRoutes);

app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));

const port = Number(process.env.API_SERVER_PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`API server running on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
