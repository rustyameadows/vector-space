import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
import { VectorSpaceDb } from '../db/database';
import {
  getAssetStorageAbsolutePath,
  getAssetStorageRelativePath,
  getLibraryPaths
} from '../library/pathManager';
import type { AssetRecord } from '../types/domain';

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

const extensionToMime = (ext: string): string => {
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
};

const checksumFile = async (inputPath: string): Promise<string> => {
  const buffer = await fs.readFile(inputPath);
  return createHash('sha256').update(buffer).digest('hex');
};

const ensureParentDirectory = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const createThumbnail = async (sourcePath: string, outputPath: string): Promise<void> => {
  const image = nativeImage.createFromPath(sourcePath);
  const thumb = image.resize({ width: 320, height: 320, quality: 'best' });

  await ensureParentDirectory(outputPath);
  await fs.writeFile(outputPath, thumb.toPNG());
};

export class ImportService {
  public constructor(private readonly db: VectorSpaceDb) {}

  public async importPaths(
    inputPaths: string[],
    importSource: AssetRecord['importSource']
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const inputPath of inputPaths) {
      const extension = path.extname(inputPath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        skipped += 1;
        continue;
      }

      const checksum = await checksumFile(inputPath);
      const existingId = this.db.findAssetByChecksum(checksum);
      if (existingId) {
        skipped += 1;
        continue;
      }

      const id = randomUUID().replace(/-/g, '');
      const sourceStat = await fs.stat(inputPath);
      const image = nativeImage.createFromPath(inputPath);
      const size = image.getSize();
      const libraryPaths = getLibraryPaths();
      const originalRelative = getAssetStorageRelativePath(
        id,
        path.basename(inputPath),
        'originals'
      );
      const originalAbsolute = path.join(libraryPaths.root, originalRelative);
      const thumbAbsolute = getAssetStorageAbsolutePath(`${id}-grid`, '.png', 'thumbnails');

      await ensureParentDirectory(originalAbsolute);
      await fs.copyFile(inputPath, originalAbsolute);
      await createThumbnail(originalAbsolute, thumbAbsolute);

      const asset: AssetRecord = {
        id,
        createdAt: new Date().toISOString(),
        importSource,
        mime: extensionToMime(extension),
        width: size.width,
        height: size.height,
        checksum,
        status: 'imported',
        sourcePath: inputPath
      };

      this.db.insertAsset(asset, originalAbsolute, sourceStat.size, thumbAbsolute);
      imported += 1;
    }

    return { imported, skipped };
  }

  public async collectFolderImages(folderPath: string): Promise<string[]> {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const absolutePath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.collectFolderImages(absolutePath)));
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(extension)) {
        files.push(absolutePath);
      }
    }

    return files;
  }
}
