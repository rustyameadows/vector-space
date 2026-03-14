import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const workspaceHome = path.join(repoRoot, '.electron-rebuild-home');
const electronGypDir = path.join(workspaceHome, '.electron-gyp');

await mkdir(electronGypDir, { recursive: true });

process.env.HOME = workspaceHome;
process.env.npm_config_devdir = electronGypDir;

const { rebuild } = await import('@electron/rebuild');

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
