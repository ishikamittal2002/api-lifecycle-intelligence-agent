import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../config/db.js';

const InvestigationOutputSchema = z.object({
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  summary: z.string().min(10),
  reasoning: z.string().min(10),
  recommendedAction: z.enum(['SAFE_TO_REMOVE', 'DEPRECATE_FIRST', 'KEEP_ACTIVE']),
  confidenceScore: z.number().min(0).max(1),
  suggestedPatch: z.string().min(5),
});

type InvestigationOutput = z.infer<typeof InvestigationOutputSchema>;

function extractCodeSnippet(
  repoLocalPath: string,
  relativeFilePath: string,
  lineNumber: number
): string {
  const fullPath = path.join(repoLocalPath, relativeFilePath);
  if (!fs.existsSync(fullPath)) {
    return '// Source file not found on disk';
  }

  const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
  const start = Math.max(0, lineNumber - 4);
  const end = Math.min(lines.length, lineNumber + 12);

  return lines
    .slice(start, end)
    .map((line, idx) => `${start + idx + 1}: ${line}`)
    .join('\n');
}

function countPathReferences(repoLocalPath: string, routePath: string): number {
  if (!fs.existsSync(repoLocalPath)) return 0;
  let matches = 0;

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        const content = fs.readFileSync(full, 'utf-8');
        const occurrences = content.split(routePath).length - 1;
        matches += occurrences;
      }
    }
  }

  walk(repoLocalPath);
  return matches;
}

async function generateAnalysisWithLLMOrFallback(params: {
  method: string;
  routePath: string;
  filePath: string;
  lineNumber: number;
  codeSnippet: string;
  referenceCount: number;
  requestCount: number;
}): Promise<InvestigationOutput> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    const prompt = `You are a senior backend engineer auditing inactive API endpoints for safe cleanup.
Analyze this endpoint and return ONLY valid JSON with keys:
- "riskLevel": "LOW" | "MEDIUM" | "HIGH"
- "summary": one-sentence executive summary of the finding
- "reasoning": clear technical explanation
- "recommendedAction": "SAFE_TO_REMOVE" | "DEPRECATE_FIRST" | "KEEP_ACTIVE"
- "confidenceScore": number between 0 and 1
- "suggestedPatch": concise code diff or deprecation snippet

Endpoint: ${params.method} ${params.routePath}
File: ${params.filePath}:${params.lineNumber}
References in repo: ${params.referenceCount}
Recent requests (30d): ${params.requestCount}
Code context:
${params.codeSnippet}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      if (rawContent) {
        const parsed = JSON.parse(rawContent);
        return InvestigationOutputSchema.parse(parsed);
      }
    }
  }

  // Deterministic static + telemetry fallback when OPENAI_API_KEY is not configured
  const isInternalAdminOrCore =
    params.routePath.includes('health') || params.routePath.includes('scans');
  const riskLevel =
    params.referenceCount > 1 || isInternalAdminOrCore ? 'MEDIUM' : 'LOW';
  const recommendedAction =
    riskLevel === 'LOW' ? 'SAFE_TO_REMOVE' : 'DEPRECATE_FIRST';

  const fallbackOutput: InvestigationOutput = {
    riskLevel,
    summary: `${params.method} ${params.routePath} has ${params.requestCount} recorded calls and ${params.referenceCount} repo reference(s); recommended action: ${recommendedAction}.`,
    reasoning: `Endpoint ${params.method} ${params.routePath} at ${params.filePath}:${params.lineNumber} recorded ${params.requestCount} requests in the active telemetry window and appears ${params.referenceCount} time(s) in repository source files. ${
      riskLevel === 'LOW'
        ? 'No external callers or internal references were detected, making it a strong candidate for removal after human review.'
        : 'Because this route is referenced in core routing modules or internal workflows, adding a deprecation header before removal is recommended.'
    }`,
    recommendedAction,
    confidenceScore: riskLevel === 'LOW' ? 0.91 : 0.78,
    suggestedPatch:
      recommendedAction === 'SAFE_TO_REMOVE'
        ? `// Remove unused route handler in ${params.filePath} (line ${params.lineNumber}):\n- router.${params.method.toLowerCase()}('${params.routePath}', ...);`
        : `// Mark ${params.method} ${params.routePath} as deprecated in ${params.filePath}:\n+ res.setHeader('Deprecation', 'true');\n+ res.setHeader('Sunset', '2026-12-31');`,
  };

  return InvestigationOutputSchema.parse(fallbackOutput);
}

export async function investigateEndpoint(endpointId: string) {
  const endpoint = await prisma.endpoint.findUnique({
    where: { id: endpointId },
    include: {
      repository: true,
      usageMetrics: {
        orderBy: { recordedAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!endpoint) {
    throw new Error(`Endpoint not found: ${endpointId}`);
  }

  const codeSnippet = extractCodeSnippet(
    endpoint.repository.localPath,
    endpoint.filePath,
    endpoint.lineNumber
  );
  const referenceCount = countPathReferences(
    endpoint.repository.localPath,
    endpoint.path
  );
  const requestCount = endpoint.usageMetrics[0]?.requestCount ?? 0;

  const analysis = await generateAnalysisWithLLMOrFallback({
    method: endpoint.method,
    routePath: endpoint.path,
    filePath: endpoint.filePath,
    lineNumber: endpoint.lineNumber,
    codeSnippet,
    referenceCount,
    requestCount,
  });

  const report = await prisma.investigationReport.create({
    data: {
      endpointId: endpoint.id,
      riskLevel: analysis.riskLevel,
      summary: analysis.summary,
      reasoning: analysis.reasoning,
      recommendedAction: analysis.recommendedAction,
      evidence: {
        filePath: endpoint.filePath,
        lineNumber: endpoint.lineNumber,
        referenceCount,
        requestCount,
        confidenceScore: analysis.confidenceScore,
        suggestedPatch: analysis.suggestedPatch,
        codeSnippet,
      },
      approvalStatus: 'PENDING',
    },
    include: {
      endpoint: true,
    },
  });

  return { report };
}

export async function reviewInvestigationReport(params: {
  reportId: string;
  decision: 'APPROVED' | 'REJECTED';
  reviewedBy?: string;
}) {
  const existing = await prisma.investigationReport.findUnique({
    where: { id: params.reportId },
    include: { endpoint: true },
  });

  if (!existing) {
    throw new Error(`Investigation report not found: ${params.reportId}`);
  }

  await prisma.investigationReport.update({
    where: { id: params.reportId },
    data: {
      approvalStatus: params.decision,
      reviewedBy: params.reviewedBy?.trim() || 'developer',
      reviewedAt: new Date(),
    },
  });

  if (params.decision === 'APPROVED') {
    const nextEndpointStatus =
      existing.recommendedAction === 'SAFE_TO_REMOVE'
        ? 'ARCHIVED'
        : 'DEPRECATED';

    await prisma.endpoint.update({
      where: { id: existing.endpointId },
      data: { status: nextEndpointStatus },
    });
  }

  return prisma.investigationReport.findUnique({
    where: { id: params.reportId },
    include: { endpoint: true },
  });
}