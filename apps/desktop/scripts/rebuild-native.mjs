import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rebuild } from '@electron/rebuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const electronPackageJson = JSON.parse(
  await readFile(path.join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
);

const electronVersion = electronPackageJson.version;
const arch = process.env.npm_config_arch || process.arch;

await rebuild({
  buildPath: appDir,
  projectRootPath: repoRoot,
  electronVersion,
  arch,
  force: true,
  onlyModules: ['better-sqlite3', 'keytar'],
});

console.log(`Rebuilt native Electron modules for arch=${arch} and electron=${electronVersion}.`);
