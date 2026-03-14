import type { AspectBucket, DominantColorFamily, Orientation } from './contracts';

export const deriveOrientation = (width: number, height: number): Orientation => {
  const safeHeight = Math.max(height, 1);
  const ratio = width / safeHeight;
  if (ratio >= 1.05) {
    return 'landscape';
  }
  if (ratio <= 0.95) {
    return 'portrait';
  }
  return 'square';
};

export const deriveAspectBucket = (width: number, height: number): AspectBucket => {
  const ratio = width / Math.max(height, 1);
  if (ratio >= 2) {
    return 'ultrawide';
  }
  if (ratio >= 1.35) {
    return 'wide';
  }
  if (ratio > 0.85 && ratio < 1.15) {
    return 'square';
  }
  if (ratio <= 0.5) {
    return 'tall';
  }
  if (ratio < 0.85) {
    return 'portrait';
  }
  return 'standard';
};

export const formatImportSourceLabel = (importSource: string): string => {
  if (importSource === 'drag-drop') {
    return 'Drag and drop';
  }

  return importSource
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

export const formatColorFamilyLabel = (color: DominantColorFamily): string =>
  color.charAt(0).toUpperCase() + color.slice(1);
