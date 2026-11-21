import { Router, Request, Response } from 'express';
import { prisma } from '../config/db.js';
import { runAndSaveScan } from '../services/scanService.js';

const router = Router();

router.post('/scans', async (req: Request, res: Response) => {
  try {
    const { name, localPath, repoUrl } = req.body as {
      name?: string;
      localPath?: string;
      repoUrl?: string;
    };

    if (!localPath || typeof localPath !== 'string') {
      res.status(400).json({ error: 'localPath is required' });
      return;
    }

    const result = await runAndSaveScan({ name, localPath, repoUrl });
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to scan repository',
    });
  }
});

router.get('/repositories', async (_req: Request, res: Response) => {
  try {
    const repositories = await prisma.repository.findMany({
      include: {
        endpoints: {
          orderBy: { path: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ repositories });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch repositories',
    });
  }
});

export default router;