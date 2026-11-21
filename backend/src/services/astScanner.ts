import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import { ExtractedEndpoint, ScanResult } from '../types/scanner.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

function collectSourceFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

function extractHandlerName(args: ts.NodeArray<ts.Expression>): string | null {
  if (args.length < 2) return null;
  const lastArg = args[args.length - 1];

  if (ts.isIdentifier(lastArg)) {
    return lastArg.text;
  }
  if (ts.isPropertyAccessExpression(lastArg)) {
    return lastArg.getText();
  }
  if (ts.isArrowFunction(lastArg) || ts.isFunctionExpression(lastArg)) {
    return 'inlineHandler';
  }
  return null;
}

export function scanFileForEndpoints(filePath: string, rootDir: string): ExtractedEndpoint[] {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
  const endpoints: ExtractedEndpoint[] = [];
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text.toLowerCase();

      if (HTTP_METHODS.has(methodName) && node.arguments.length >= 2) {
        const firstArg = node.arguments[0];

        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          endpoints.push({
            method: methodName.toUpperCase(),
            path: firstArg.text,
            filePath: relativePath,
            lineNumber: line + 1,
            handlerName: extractHandlerName(node.arguments),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return endpoints;
}

export function scanRepository(repositoryPath: string): ScanResult {
  const resolvedPath = path.resolve(repositoryPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Repository path does not exist: ${resolvedPath}`);
  }

  const files = collectSourceFiles(resolvedPath);
  const endpoints: ExtractedEndpoint[] = [];

  for (const file of files) {
    endpoints.push(...scanFileForEndpoints(file, resolvedPath));
  }

  return {
    repositoryPath: resolvedPath,
    filesScanned: files.length,
    endpoints,
  };
}
