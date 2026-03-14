/* global console */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const expectedModel = ['gemini', 'embedding', '2', 'preview'].join('-');
const legacyModel = ['gemini', 'embedding', '001'].join('-');
const modelLiteralPattern = /gemini-embedding-[a-z0-9-]+/g;
const allowedLiteralFiles = new Set([
  'README.md',
  'docs/gemini-integration-notes.md',
  'docs/implementation-progress.md',
  'apps/desktop/src/shared/gemini.ts'
]);

const shouldScanFile = (relativePath) => {
  if (relativePath === 'README.md') {
    return true;
  }

  if (relativePath.startsWith('docs/') && relativePath.endsWith('.md')) {
    return true;
  }

  if (relativePath.startsWith('apps/desktop/src/') && /\.(ts|tsx)$/.test(relativePath)) {
    return true;
  }

  if (relativePath.startsWith('apps/desktop/scripts/') && /\.(mjs|js)$/.test(relativePath)) {
    return true;
  }

  return false;
};

const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
const trackedFiles = stdout
  .trim()
  .split('\n')
  .map((entry) => entry.trim())
  .filter(Boolean);

const failures = [];

for (const relativePath of trackedFiles) {
  if (!shouldScanFile(relativePath)) {
    continue;
  }

  const absolutePath = path.join(repoRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  const matches = Array.from(new Set(content.match(modelLiteralPattern) ?? []));

  if (matches.length === 0) {
    continue;
  }

  if (matches.includes(legacyModel)) {
    failures.push(`${relativePath}: found forbidden legacy model literal ${legacyModel}`);
  }

  const unexpectedModels = matches.filter((model) => model !== expectedModel);
  if (unexpectedModels.length > 0) {
    failures.push(
      `${relativePath}: found unexpected Gemini embedding literal(s): ${unexpectedModels.join(', ')}`
    );
  }

  if (!allowedLiteralFiles.has(relativePath)) {
    failures.push(
      `${relativePath}: Gemini embedding model literals must come from apps/desktop/src/shared/gemini.ts`
    );
  }
}

if (failures.length > 0) {
  console.error('Gemini model lock verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Gemini model lock verified for ${trackedFiles.length} tracked files.`);
