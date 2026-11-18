import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'api-lifecycle-intelligence-agent',
    timestamp: new Date().toISOString(),
  });
});

export default app;
