import { prisma } from '../config/db.js';

export interface IngestUsageInput {
  endpointId: string;
  requestCount: number;
  lastCalledAt?: string;
  avgLatencyMs?: number;
  windowDays?: number;
}

export async function ingestUsageMetric(input: IngestUsageInput) {
  const endpoint = await prisma.endpoint.findUnique({
    where: { id: input.endpointId },
  });

  if (!endpoint) {
    throw new Error(`Endpoint not found: ${input.endpointId}`);
  }

  return prisma.usageMetric.create({
    data: {
      endpointId: input.endpointId,
      requestCount: input.requestCount,
      lastCalledAt: input.lastCalledAt ? new Date(input.lastCalledAt) : null,
      avgLatencyMs: input.avgLatencyMs ?? null,
      windowDays: input.windowDays ?? 30,
    },
  });
}

export async function evaluateRepositoryEndpoints(
  repositoryId: string,
  inactiveDaysThreshold = 30
) {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: {
      endpoints: {
        include: {
          usageMetrics: {
            orderBy: { recordedAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  if (!repository) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  const cutoffDate = new Date(
    Date.now() - inactiveDaysThreshold * 24 * 60 * 60 * 1000
  );
  const updates = [];

  for (const ep of repository.endpoints) {
    const latestMetric = ep.usageMetrics[0];
    const hasZeroRequests = !latestMetric || latestMetric.requestCount === 0;
    const isStaleCall =
      !latestMetric?.lastCalledAt || latestMetric.lastCalledAt < cutoffDate;

    const nextStatus = hasZeroRequests && isStaleCall ? 'INACTIVE' : 'ACTIVE';

    if (
      ep.status !== nextStatus &&
      ep.status !== 'DEPRECATED' &&
      ep.status !== 'ARCHIVED'
    ) {
      const updated = await prisma.endpoint.update({
        where: { id: ep.id },
        data: { status: nextStatus },
      });
      updates.push(updated);
    }
  }

  const refreshed = await prisma.endpoint.findMany({
    where: { repositoryId },
    include: { usageMetrics: { orderBy: { recordedAt: 'desc' }, take: 1 } },
    orderBy: { path: 'asc' },
  });

  return {
    repositoryId,
    inactiveDaysThreshold,
    updatedCount: updates.length,
    endpoints: refreshed,
  };
}