import { app } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const LIBRARY_FOLDER_NAME = 'Vector Space Library';

export const LIBRARY_SUBFOLDERS = {
  originals: 'originals',
  thumbnails: 'thumbnails',
  db: 'db',
  temp: 'temp'
} as const;

export type LibrarySubfolderKey = keyof typeof LIBRARY_SUBFOLDERS;

type LibraryErrorCode = 'PERMISSION_DENIED' | 'DISK_WRITE_FAILED' | 'UNSUPPORTED_PLATFORM' | 'UNKNOWN';

export class LibraryPathError extends Error {
  public readonly code: LibraryErrorCode;

  public readonly userMessage: string;

  public readonly causeError?: unknown;

  public constructor(code: LibraryErrorCode, userMessage: string, causeError?: unknown) {
    super(userMessage);
    this.name = 'LibraryPathError';
    this.code = code;
    this.userMessage = userMessage;
    this.causeError = causeError;
  }
}

export interface LibraryPaths {
  root: string;
  originals: string;
  thumbnails: string;
  db: string;
  temp: string;
}

const isNodeErrorWithCode = (error: unknown): error is NodeJS.ErrnoException => {
  return typeof error === 'object' && error !== null && 'code' in error;
};

const mapFsError = (error: unknown): LibraryPathError => {
  if (isNodeErrorWithCode(error)) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return new LibraryPathError(
        'PERMISSION_DENIED',
        'Vector Space cannot access the selected library location. Please check folder permissions in System Settings.',
        error
      );
    }

    if (error.code === 'ENOSPC' || error.code === 'EROFS') {
      return new LibraryPathError(
        'DISK_WRITE_FAILED',
        'Vector Space cannot write to the library because the disk is full or read-only. Free space or choose a writable disk and try again.',
        error
      );
    }
  }

  return new LibraryPathError(
    'UNKNOWN',
    'Vector Space could not initialize the local library. Please try again or choose a different location.',
    error
  );
};

export const resolveLibraryRoot = (): string => {
  const overrideRoot = process.env.VECTOR_SPACE_LIBRARY_ROOT?.trim();
  if (overrideRoot) {
    return path.resolve(overrideRoot);
  }

  if (process.platform !== 'darwin') {
    throw new LibraryPathError(
      'UNSUPPORTED_PLATFORM',
      'Vector Space local library setup currently supports macOS only.'
    );
  }

  return path.join(os.homedir(), 'Pictures', LIBRARY_FOLDER_NAME);
};

export const getLibraryPaths = (): LibraryPaths => {
  const root = resolveLibraryRoot();

  return {
    root,
    originals: path.join(root, LIBRARY_SUBFOLDERS.originals),
    thumbnails: path.join(root, LIBRARY_SUBFOLDERS.thumbnails),
    db: path.join(root, LIBRARY_SUBFOLDERS.db),
    temp: path.join(root, LIBRARY_SUBFOLDERS.temp)
  };
};

const ensureDirectory = async (directoryPath: string): Promise<void> => {
  try {
    await fs.mkdir(directoryPath, { recursive: true });
  } catch (error: unknown) {
    throw mapFsError(error);
  }
};

const ensureWritable = async (directoryPath: string): Promise<void> => {
  const markerPath = path.join(directoryPath, `.write-check-${randomUUID()}`);

  try {
    await fs.writeFile(markerPath, 'ok', { encoding: 'utf8' });
    await fs.unlink(markerPath);
  } catch (error: unknown) {
    throw mapFsError(error);
  }
};

export const ensureLibraryLayout = async (): Promise<LibraryPaths> => {
  const libraryPaths = getLibraryPaths();

  await Promise.all(
    Object.values(libraryPaths).map(async (directoryPath: string) => {
      await ensureDirectory(directoryPath);
    })
  );

  await ensureWritable(libraryPaths.temp);

  return libraryPaths;
};

const sanitizeAssetId = (assetId: string): string => {
  const cleanAssetId = assetId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

  if (!cleanAssetId) {
    throw new Error('Asset id must contain at least one alphanumeric character.');
  }

  return cleanAssetId;
};

const normalizeExtension = (filename?: string): string => {
  if (!filename) {
    return '';
  }

  const ext = path.extname(filename).toLowerCase();

  return ext;
};

export const getAssetStorageRelativePath = (
  assetId: string,
  originalFilename?: string,
  librarySubfolder: Extract<LibrarySubfolderKey, 'originals' | 'thumbnails'> = 'originals'
): string => {
  const cleanAssetId = sanitizeAssetId(assetId);
  const shardA = cleanAssetId.slice(0, 2) || '00';
  const shardB = cleanAssetId.slice(2, 4) || '00';
  const extension = normalizeExtension(originalFilename);

  return path.join(LIBRARY_SUBFOLDERS[librarySubfolder], shardA, shardB, `${cleanAssetId}${extension}`);
};

export const getAssetStorageAbsolutePath = (
  assetId: string,
  originalFilename?: string,
  librarySubfolder: Extract<LibrarySubfolderKey, 'originals' | 'thumbnails'> = 'originals'
): string => {
  const libraryRoot = resolveLibraryRoot();
  const relativePath = getAssetStorageRelativePath(assetId, originalFilename, librarySubfolder);

  return path.join(libraryRoot, relativePath);
};

export const initializeLibraryPathing = async (): Promise<LibraryPaths> => {
  const libraryPaths = await ensureLibraryLayout();
  app.setPath('userData', libraryPaths.db);
  return libraryPaths;
};
