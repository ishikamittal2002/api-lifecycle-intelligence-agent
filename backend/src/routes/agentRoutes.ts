import { Router, Request, Response } from 'express';
import { prisma } from '../config/db.js';
import {
  investigateEndpoint,
  reviewInvestigationReport,
} from '../services/aiAgentService.js';

const router = Router();

router.post(
  '/endpoints/:id/investigate',
  async (req: Request, res: Response) => {
    try {
      const endpointId = String(req.params.id);
      const result = await investigateEndpoint(endpointId);
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to investigate endpoint',
      });
    }
  }
);

router.get('/reports', async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status
      ? String(req.query.status).toUpperCase()
      : undefined;

    const reports = await prisma.investigationReport.findMany({
      where:
        statusFilter &&
        ['PENDING', 'APPROVED', 'REJECTED'].includes(statusFilter)
          ? {
              approvalStatus: statusFilter as
                | 'PENDING'
                | 'APPROVED'
                | 'REJECTED',
            }
          : undefined,
      include: {
        endpoint: {
          include: {
            repository: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ reports });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error ? error.message : 'Failed to fetch reports',
    });
  }
});

router.patch(
  '/reports/:id/decision',
  async (req: Request, res: Response) => {
    try {
      const reportId = String(req.params.id);
      const { decision, reviewedBy } = req.body as {
        decision?: string;
        reviewedBy?: string;
      };

      if (decision !== 'APPROVED' && decision !== 'REJECTED') {
        res
          .status(400)
          .json({ error: 'decision must be either APPROVED or REJECTED' });
        return;
      }

      const report = await reviewInvestigationReport({
        reportId,
        decision,
        reviewedBy,
      });

      res.status(200).json({ report });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to submit review decision',
      });
    }
  }
);

export default router;
