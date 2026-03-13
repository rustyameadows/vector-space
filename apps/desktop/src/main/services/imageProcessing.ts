import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SIPS_PATH = '/usr/bin/sips';

export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.tif'
] as const;

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
}

const ensureParentDirectory = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const parseSipsOutput = (output: string): Record<string, string> => {
  return output
    .trim()
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((properties, segment) => {
      const separatorIndex = segment.indexOf(':');
      if (separatorIndex === -1) {
        return properties;
      }

      const key = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      properties[key] = value;
      return properties;
    }, {});
};

export const getImageMetadata = async (sourcePath: string): Promise<ImageMetadata> => {
  const { stdout } = await execFileAsync(SIPS_PATH, [
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    '-g',
    'format',
    '-1',
    sourcePath
  ]);
  const properties = parseSipsOutput(stdout);
  const width = Number(properties.pixelWidth);
  const height = Number(properties.pixelHeight);
  const format = properties.format ?? path.extname(sourcePath).replace(/^\./, '').toLowerCase();

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Could not read image dimensions for ${sourcePath}.`);
  }

  return { width, height, format };
};

export const createThumbnail = async (sourcePath: string, outputPath: string): Promise<void> => {
  await ensureParentDirectory(outputPath);
  await execFileAsync(SIPS_PATH, [
    '-s',
    'format',
    'png',
    '-z',
    '320',
    '320',
    sourcePath,
    '--out',
    outputPath
  ]);
};
