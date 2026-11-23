import { Router, Request, Response } from 'express';
import {
  ingestUsageMetric,
  evaluateRepositoryEndpoints,
} from '../services/usageService.js';

const router = Router();

router.post('/usage/ingest', async (req: Request, res: Response) => {
  try {
    const { endpointId, requestCount, lastCalledAt, avgLatencyMs, windowDays } =
      req.body as {
        endpointId?: string;
        requestCount?: number;
        lastCalledAt?: string;
        avgLatencyMs?: number;
        windowDays?: number;
      };

    if (!endpointId || typeof requestCount !== 'number') {
      res
        .status(400)
        .json({ error: 'endpointId and numeric requestCount are required' });
      return;
    }

    const metric = await ingestUsageMetric({
      endpointId,
      requestCount,
      lastCalledAt,
      avgLatencyMs,
      windowDays,
    });

    res.status(201).json({ metric });
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : 'Failed to ingest usage metric',
    });
  }
});

router.post(
  '/repositories/:id/evaluate-status',
  async (req: Request, res: Response) => {
    try {
      const repositoryId = String(req.params.id);
      const { inactiveDaysThreshold } = (req.body ?? {}) as {
        inactiveDaysThreshold?: number;
      };

      const result = await evaluateRepositoryEndpoints(
        repositoryId,
        inactiveDaysThreshold ?? 30
      );
      res.status(200).json(result);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to evaluate endpoint statuses',
      });
    }
  }
);

export default router;