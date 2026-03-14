import path from 'node:path';
import type {
  AspectBucket,
  AssetEnrichmentView,
  DominantColorFamily,
  Orientation
} from '../../shared/contracts';
import { formatColorFamilyLabel } from '../../shared/assetMetadata';

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const dedupe = (values: string[]): string[] => Array.from(new Set(values));

const formatOrientationLabel = (orientation: Orientation): string => {
  if (orientation === 'square') {
    return 'square';
  }

  return `${orientation} composition`;
};

const formatAspectBucketLabel = (aspectBucket: AspectBucket): string => {
  switch (aspectBucket) {
    case 'ultrawide':
      return 'ultrawide layout';
    case 'wide':
      return 'wide layout';
    case 'portrait':
      return 'portrait layout';
    case 'tall':
      return 'tall layout';
    case 'square':
      return 'square layout';
    default:
      return 'balanced layout';
  }
};

const formatDominantColors = (colors: DominantColorFamily[]): string => {
  if (colors.length === 0) {
    return 'Dominant colors: unknown.';
  }

  return `Dominant colors: ${colors.map(formatColorFamilyLabel).join(', ')}.`;
};

export const collectPathTokens = (sourcePath: string): string[] => {
  const parsed = path.parse(sourcePath);
  const folderSegments = parsed.dir
    .split(path.sep)
    .slice(-3)
    .flatMap((segment) => tokenize(segment));

  return dedupe([...tokenize(parsed.name), ...folderSegments]);
};

export const buildRetrievalCaption = (params: {
  title: string;
  note: string;
  tags: string[];
  collections: string[];
  enrichment: Pick<
    AssetEnrichmentView,
    'dominantColors' | 'orientation' | 'aspectBucket' | 'hasText'
  >;
}): string => {
  const title = params.title.trim() || 'Untitled inspiration';
  const tags = params.tags.length > 0 ? `Tags: ${params.tags.join(', ')}.` : 'Tags: none.';
  const collections =
    params.collections.length > 0
      ? `Collections: ${params.collections.join(', ')}.`
      : 'Collections: none.';
  const note = params.note.trim() ? `Note: ${params.note.trim()}.` : 'Note: none.';
  const visual = `${formatOrientationLabel(params.enrichment.orientation)}. ${formatAspectBucketLabel(params.enrichment.aspectBucket)}. ${formatDominantColors(params.enrichment.dominantColors)}`;
  const text = params.enrichment.hasText ? 'Contains readable text.' : 'No readable text detected.';

  return `${title}. ${visual} ${text} ${tags} ${collections} ${note}`.replace(/\s+/g, ' ').trim();
};

export const buildSearchSections = (params: {
  title: string;
  note: string;
  retrievalCaption: string;
  tags: string[];
  collections: string[];
  ocrText: string;
  dominantColors: DominantColorFamily[];
  orientation: Orientation;
  aspectBucket: AspectBucket;
  hasText: boolean;
  sourcePath: string;
  exif: Record<string, string | number | boolean | null>;
}): Array<{ section: string; content: string }> => {
  const pathTokens = collectPathTokens(params.sourcePath).join(' ');
  const exifEntries = Object.entries(params.exif)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${key} ${String(value)}`);

  return [
    {
      section: 'summary',
      content: [params.title, params.retrievalCaption].filter(Boolean).join('. ')
    },
    {
      section: 'note',
      content: params.note.trim()
    },
    {
      section: 'organization',
      content: [...params.tags, ...params.collections].join(' ')
    },
    {
      section: 'visual',
      content: [
        params.orientation,
        params.aspectBucket,
        params.dominantColors.join(' '),
        params.hasText ? 'contains text' : 'no text'
      ]
        .join(' ')
        .trim()
    },
    {
      section: 'ocr',
      content: params.ocrText.trim()
    },
    {
      section: 'source',
      content: [pathTokens, ...exifEntries].filter(Boolean).join(' ')
    }
  ].filter((section) => section.content.trim().length > 0);
};

export const buildSearchDocument = (
  sections: Array<{ section: string; content: string }>
): string =>
  sections
    .map((section) => section.content)
    .join('\n')
    .trim();
