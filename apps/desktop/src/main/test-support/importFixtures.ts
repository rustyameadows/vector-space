import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import fixtures from './import-format-fixtures.json';

const execFileAsync = promisify(execFile);
const SIPS_PATH = '/usr/bin/sips';

export type ImportFixture = {
  name: string;
  extension: string;
  mime: string;
  base64: string;
};

export const importFixtureEntries = fixtures as ImportFixture[];

export const getImportFixture = (extension: string): ImportFixture => {
  const normalizedExtension = extension === '.tif' ? '.tiff' : extension;
  const fixture = importFixtureEntries.find((entry) => entry.extension === normalizedExtension);

  if (!fixture) {
    throw new Error(`Missing import fixture for ${extension}`);
  }

  return fixture;
};

export const supportedImportEntries: ImportFixture[] = [
  ...importFixtureEntries,
  {
    ...getImportFixture('.tiff'),
    name: 'tif',
    extension: '.tif'
  }
];

export const materializeImportFixture = async (
  targetDir: string,
  extension: string,
  outputName?: string
): Promise<string> => {
  await mkdir(targetDir, { recursive: true });

  const fixture = getImportFixture(extension);
  const filePath = path.join(targetDir, `${outputName ?? fixture.name}${extension}`);

  if (extension === '.tiff' || extension === '.tif') {
    const pngFixture = getImportFixture('.png');
    const tempPngPath = path.join(targetDir, `${outputName ?? pngFixture.name}-source${pngFixture.extension}`);
    await writeFile(tempPngPath, Buffer.from(pngFixture.base64, 'base64'));
    try {
      await execFileAsync(SIPS_PATH, ['-s', 'format', 'tiff', tempPngPath, '--out', filePath]);
      if (extension === '.tif') {
        await execFileAsync(SIPS_PATH, ['-s', 'dpiWidth', '73', '-s', 'dpiHeight', '73', filePath]);
      }
    } finally {
      await rm(tempPngPath, { force: true });
    }
    return filePath;
  }

  await writeFile(filePath, Buffer.from(fixture.base64, 'base64'));

  if (extension === '.jpeg') {
    await execFileAsync(SIPS_PATH, ['-s', 'dpiWidth', '73', '-s', 'dpiHeight', '73', filePath]);
  }

  return filePath;
};

export const materializeImportFixtures = async (targetDir: string): Promise<string[]> => {
  const paths: string[] = [];

  for (const fixture of supportedImportEntries) {
    paths.push(await materializeImportFixture(targetDir, fixture.extension));
  }

  return paths;
};

export const resizeFixtureImage = async (
  sourcePath: string,
  width: number,
  height: number
): Promise<void> => {
  await execFileAsync(SIPS_PATH, ['-z', `${height}`, `${width}`, sourcePath, '--out', sourcePath]);
};
