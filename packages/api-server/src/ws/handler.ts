import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';

interface ConnectedClient {
  ws: WebSocket;
  userId?: string;
}

const clients = new Map<string, ConnectedClient>();

export function broadcastToUser(userId: string, message: Record<string, unknown>) {
  for (const [, client] of clients) {
    if (client.userId === userId && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
    }
  }
}

export default async function wsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const clientId = crypto.randomUUID();
    const client: ConnectedClient = { ws: socket };
    clients.set(clientId, client);

    app.log.info(`WS client connected: ${clientId}`);

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'auth':
            // Client sends JWT token for identification
            client.userId = msg.userId;
            socket.send(JSON.stringify({ type: 'auth:ok' }));
            break;

          case 'synth:state':
            // Client broadcasts synth state update (for Agent to read)
            // Forward to agent-server via internal API if needed
            break;

          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            app.log.warn(`Unknown WS message type: ${msg.type}`);
        }
      } catch {
        app.log.warn('Invalid WS message');
      }
    });

    socket.on('close', () => {
      clients.delete(clientId);
      app.log.info(`WS client disconnected: ${clientId}`);
    });
  });
}
