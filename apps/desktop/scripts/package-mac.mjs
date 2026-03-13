import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import packager from 'electron-packager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const cliArch = process.argv.find((arg) => arg.startsWith('--arch='))?.split('=')[1];
const arch = cliArch || process.env.npm_config_arch || process.arch;

if (!['arm64', 'x64'].includes(arch)) {
  throw new Error(`Unsupported macOS arch "${arch}". Use arm64 or x64.`);
}

const releaseDir = path.join(appDir, 'release');
await mkdir(releaseDir, { recursive: true });
const electronCacheDir = path.join(appDir, '.electron-cache');
await mkdir(electronCacheDir, { recursive: true });

const stageDir = path.join(appDir, '.package', `mac-${arch}`);
await rm(stageDir, { recursive: true, force: true });
await mkdir(path.join(stageDir, 'node_modules'), { recursive: true });

const packageJsonPath = path.join(appDir, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

delete packageJson.devDependencies;
delete packageJson.scripts;

await writeFile(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(packageJson, null, 2)}\n`,
);

await cp(path.join(appDir, 'dist'), path.join(stageDir, 'dist'), { recursive: true });

const dependencyTree = JSON.parse(
  execFileSync(
    'npm',
    ['ls', '--omit=dev', '--all', '--json', '--workspace', packageJson.name],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  ),
);

const runtimePackages = new Set();

const collectPackages = (dependencies) => {
  for (const [name, metadata] of Object.entries(dependencies ?? {})) {
    if (name !== packageJson.name) {
      runtimePackages.add(name);
    }
    collectPackages(metadata.dependencies);
  }
};

collectPackages(dependencyTree.dependencies);

for (const packageName of runtimePackages) {
  const segments = packageName.split('/');
  const sourceDir = path.join(repoRoot, 'node_modules', ...segments);
  const targetDir = path.join(stageDir, 'node_modules', ...segments);

  await stat(sourceDir);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

const [appDirPath] = await packager({
  dir: stageDir,
  name: 'Vector Space',
  platform: 'darwin',
  arch,
  out: releaseDir,
  overwrite: true,
  appBundleId: 'com.vectorspace.app',
  download: {
    cacheRoot: electronCacheDir,
  },
  prune: false,
});

const appBundlePath = path.join(appDirPath, 'Vector Space.app');
await stat(appBundlePath);

const zipPath = `${appDirPath}.zip`;
await rm(zipPath, { force: true });
execFileSync('ditto', ['-c', '-k', '--keepParent', appBundlePath, zipPath], {
  stdio: 'inherit',
});

console.log(`Packaged app: ${appBundlePath}`);
console.log(`Packaged zip: ${zipPath}`);

await rm(stageDir, { recursive: true, force: true });
