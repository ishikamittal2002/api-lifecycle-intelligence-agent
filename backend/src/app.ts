import express, { Request, Response } from "express";
import cors from "cors";
import { prisma } from "./config/db.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: "ok",
      database: "connected",
      service: "api-lifecycle-intelligence-agent",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      database: "disconnected",
      message: error instanceof Error ? error.message : "Unknown database error",
    });
  }
});

export default app;
