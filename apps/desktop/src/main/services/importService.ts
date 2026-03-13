import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { VectorSpaceDb } from '../db/database';
import {
  getAssetStorageAbsolutePath,
  getAssetStorageRelativePath,
  getLibraryPaths
} from '../library/pathManager';
import type { AssetRecord } from '../types/domain';
import {
  createThumbnail,
  getImageMetadata,
  SUPPORTED_IMAGE_EXTENSIONS
} from './imageProcessing';

const SUPPORTED_EXTENSIONS = new Set<string>(SUPPORTED_IMAGE_EXTENSIONS);

const extensionToMime = (ext: string): string => {
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.tiff' || ext === '.tif') return 'image/tiff';
  return 'image/jpeg';
};

const checksumFile = async (inputPath: string): Promise<string> => {
  const buffer = await fs.readFile(inputPath);
  return createHash('sha256').update(buffer).digest('hex');
};

const deriveTitleFromPath = (inputPath: string): string =>
  path
    .basename(inputPath, path.extname(inputPath))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const deriveLayoutHint = (width: number, height: number): string => {
  const ratio = width / Math.max(height, 1);
  if (ratio >= 1.45) return 'hero-first wide layout';
  if (ratio <= 0.85) return 'editorial vertical layout';
  return 'balanced grid layout';
};

const createRetrievalCaption = (title: string, width: number, height: number, mime: string): string => {
  const layout = deriveLayoutHint(width, height);
  return `${title || 'Untitled capture'}. ${layout}. ${mime.replace('image/', '')} inspiration asset.`;
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
      const size = await getImageMetadata(inputPath);
      const libraryPaths = getLibraryPaths();
      const originalRelative = getAssetStorageRelativePath(
        id,
        path.basename(inputPath),
        'originals'
      );
      const originalAbsolute = path.join(libraryPaths.root, originalRelative);
      const thumbAbsolute = getAssetStorageAbsolutePath(`${id}-grid`, 'grid.png', 'thumbnails');

      await fs.mkdir(path.dirname(originalAbsolute), { recursive: true });
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

      const title = deriveTitleFromPath(inputPath);
      const retrievalCaption = createRetrievalCaption(title, size.width, size.height, asset.mime);

      this.db.insertAsset(asset, originalAbsolute, sourceStat.size, thumbAbsolute, {
        title,
        userNote: '',
        retrievalCaption,
        metadataJson: JSON.stringify({
          sourceType: 'image',
          aspectRatio: Number((size.width / Math.max(size.height, 1)).toFixed(3)),
          layoutType: deriveLayoutHint(size.width, size.height),
          embeddingVersion: 'gemini-embedding-001/p3-e2-o2'
        })
      });
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
