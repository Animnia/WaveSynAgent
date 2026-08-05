import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from './auth.js';

const prisma = new PrismaClient();

interface PresetBody {
  name: string;
  tags?: string[];
  isPublic?: boolean;
  synthState: Record<string, unknown>;
}

export default async function presetRoutes(app: FastifyInstance) {
  // All routes require auth
  app.addHook('preHandler', authenticate);

  // List user's presets
  app.get('/api/presets', async (request) => {
    const userId = (request as any).userId;
    const presets = await prisma.preset.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, tags: true, isPublic: true, createdAt: true, updatedAt: true },
    });
    return { presets };
  });

  // Browse public presets
  app.get('/api/presets/public', async (request) => {
    const presets = await prisma.preset.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true } } },
    });
    return { presets };
  });

  // Get single preset
  app.get<{ Params: { id: string } }>('/api/presets/:id', async (request, reply) => {
    const userId = (request as any).userId;
    const preset = await prisma.preset.findUnique({ where: { id: request.params.id } });
    if (!preset) return reply.status(404).send({ error: 'Preset not found' });
    if (!preset.isPublic && preset.userId !== userId) {
      return reply.status(403).send({ error: 'Access denied' });
    }
    return { preset };
  });

  // Create preset
  app.post<{ Body: PresetBody }>('/api/presets', async (request, reply) => {
    const userId = (request as any).userId;
    const { name, tags, isPublic, synthState } = request.body;

    if (!name || !synthState) {
      return reply.status(400).send({ error: 'name and synthState are required' });
    }

    const preset = await prisma.preset.create({
      data: {
        userId,
        name,
        tags: tags ?? [],
        isPublic: isPublic ?? false,
        synthState: synthState as Prisma.InputJsonValue,
      },
    });
    return reply.status(201).send({ preset });
  });

  // Update preset
  app.put<{ Params: { id: string }; Body: Partial<PresetBody> }>(
    '/api/presets/:id',
    async (request, reply) => {
      const userId = (request as any).userId;
      const preset = await prisma.preset.findUnique({ where: { id: request.params.id } });
      if (!preset || preset.userId !== userId) {
        return reply.status(404).send({ error: 'Preset not found' });
      }
      const { name, tags, isPublic, synthState } = request.body;
      const updated = await prisma.preset.update({
        where: { id: request.params.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(isPublic !== undefined ? { isPublic } : {}),
          ...(synthState !== undefined
            ? { synthState: synthState as Prisma.InputJsonValue }
            : {}),
        },
      });
      return { preset: updated };
    },
  );

  // Delete preset
  app.delete<{ Params: { id: string } }>('/api/presets/:id', async (request, reply) => {
    const userId = (request as any).userId;
    const preset = await prisma.preset.findUnique({ where: { id: request.params.id } });
    if (!preset || preset.userId !== userId) {
      return reply.status(404).send({ error: 'Preset not found' });
    }
    await prisma.preset.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });
}
