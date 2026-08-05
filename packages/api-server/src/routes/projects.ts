import type { FastifyInstance } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from './auth.js';

const prisma = new PrismaClient();

interface ProjectBody {
  name: string;
  synthState: Record<string, unknown>;
  sequencerState?: Record<string, unknown>;
}

export default async function projectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/api/projects', async (request) => {
    const userId = (request as any).userId;
    const projects = await prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
    return { projects };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const userId = (request as any).userId;
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project || project.userId !== userId) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return { project };
  });

  app.post<{ Body: ProjectBody }>('/api/projects', async (request, reply) => {
    const userId = (request as any).userId;
    const { name, synthState, sequencerState } = request.body;
    if (!name || !synthState) {
      return reply.status(400).send({ error: 'name and synthState are required' });
    }
    const project = await prisma.project.create({
      data: {
        userId,
        name,
        synthState: synthState as Prisma.InputJsonValue,
        sequencerState: (sequencerState ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return reply.status(201).send({ project });
  });

  app.put<{ Params: { id: string }; Body: Partial<ProjectBody> }>(
    '/api/projects/:id',
    async (request, reply) => {
      const userId = (request as any).userId;
      const project = await prisma.project.findUnique({ where: { id: request.params.id } });
      if (!project || project.userId !== userId) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      const { name, synthState, sequencerState } = request.body;
      const updated = await prisma.project.update({
        where: { id: request.params.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(synthState !== undefined
            ? { synthState: synthState as Prisma.InputJsonValue }
            : {}),
          ...(sequencerState !== undefined
            ? { sequencerState: sequencerState as Prisma.InputJsonValue }
            : {}),
        },
      });
      return { project: updated };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const userId = (request as any).userId;
    const project = await prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project || project.userId !== userId) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    await prisma.project.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });
}
