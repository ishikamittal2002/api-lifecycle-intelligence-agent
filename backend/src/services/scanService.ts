import path from 'path';
import { prisma } from '../config/db.js';
import { scanRepository } from './astScanner.js';

export interface RunScanInput {
  name?: string;
  localPath: string;
  repoUrl?: string;
}

export async function runAndSaveScan(input: RunScanInput) {
  const resolvedPath = path.resolve(input.localPath);
  const scanResult = scanRepository(resolvedPath);
  const repoName = input.name?.trim() || path.basename(resolvedPath);

  let repository = await prisma.repository.findFirst({
    where: { localPath: resolvedPath },
  });

  if (repository) {
    repository = await prisma.repository.update({
      where: { id: repository.id },
      data: {
        name: repoName,
        repoUrl: input.repoUrl ?? repository.repoUrl,
        lastScannedAt: new Date(),
      },
    });
  } else {
    repository = await prisma.repository.create({
      data: {
        name: repoName,
        localPath: resolvedPath,
        repoUrl: input.repoUrl,
        lastScannedAt: new Date(),
      },
    });
  }

  for (const ep of scanResult.endpoints) {
    await prisma.endpoint.upsert({
      where: {
        repositoryId_method_path: {
          repositoryId: repository.id,
          method: ep.method,
          path: ep.path,
        },
      },
      update: {
        filePath: ep.filePath,
        lineNumber: ep.lineNumber,
        handlerName: ep.handlerName,
      },
      create: {
        repositoryId: repository.id,
        method: ep.method,
        path: ep.path,
        filePath: ep.filePath,
        lineNumber: ep.lineNumber,
        handlerName: ep.handlerName,
      },
    });
  }

  const fullRepository = await prisma.repository.findUnique({
    where: { id: repository.id },
    include: { endpoints: { orderBy: { path: 'asc' } } },
  });

  return {
    filesScanned: scanResult.filesScanned,
    endpointsFound: scanResult.endpoints.length,
    repository: fullRepository,
  };
}