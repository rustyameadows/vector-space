import type {
  AssetEnrichmentView,
  SuggestedTagSource
} from '../../shared/contracts';

export type SuggestedTagCandidate = {
  value: string;
  source: SuggestedTagSource;
  confidence: number;
};

type NeighborCandidateInput = {
  tag: string;
  score: number;
};

const STOP_WORDS = new Set([
  'and',
  'art',
  'asset',
  'board',
  'clip',
  'design',
  'file',
  'for',
  'from',
  'image',
  'img',
  'in',
  'inspiration',
  'jpeg',
  'jpg',
  'layout',
  'none',
  'of',
  'on',
  'png',
  'relax',
  'screenshot',
  'study',
  'the',
  'things',
  'this',
  'untitled',
  'web'
]);

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeTagValue = (value: string): string => value.trim().toLowerCase();

const keepKeyword = (value: string): boolean =>
  value.length >= 3 && !STOP_WORDS.has(value) && !/^\d+$/.test(value);

const uniqueByValue = (values: SuggestedTagCandidate[]): SuggestedTagCandidate[] => {
  const map = new Map<string, SuggestedTagCandidate>();

  values.forEach((entry) => {
    const current = map.get(entry.value);
    if (!current || entry.confidence > current.confidence) {
      map.set(entry.value, entry);
    }
  });

  return Array.from(map.values()).sort((left, right) => {
    if (left.confidence === right.confidence) {
      return left.value.localeCompare(right.value);
    }

    return right.confidence - left.confidence;
  });
};

export const buildMetadataTagCandidates = (
  enrichment: Pick<
    AssetEnrichmentView,
    'dominantColors' | 'orientation' | 'aspectBucket' | 'hasText'
  >
): SuggestedTagCandidate[] => {
  const candidates: SuggestedTagCandidate[] = [
    {
      value: enrichment.orientation,
      source: 'metadata',
      confidence: 0.96
    },
    {
      value: enrichment.aspectBucket,
      source: 'metadata',
      confidence: 0.9
    },
    ...enrichment.dominantColors.slice(0, 2).map((color, index) => ({
      value: color,
      source: 'metadata' as const,
      confidence: 0.88 - index * 0.04
    }))
  ];

  if (enrichment.hasText) {
    candidates.push({ value: 'text', source: 'metadata', confidence: 0.86 });
  }

  return candidates;
};

export const buildOcrTagCandidates = (ocrLines: string[]): SuggestedTagCandidate[] => {
  const candidates: SuggestedTagCandidate[] = [];

  ocrLines.forEach((line) => {
    const words = tokenize(line).filter(keepKeyword);
    words.slice(0, 4).forEach((word, index) => {
      candidates.push({
        value: word,
        source: 'ocr',
        confidence: 0.84 - index * 0.04
      });
    });

    if (words.length >= 2 && words.length <= 4) {
      const phrase = words.join(' ');
      if (phrase.length <= 32) {
        candidates.push({
          value: phrase,
          source: 'ocr',
          confidence: 0.78
        });
      }
    }
  });

  return uniqueByValue(candidates).slice(0, 8);
};

export const buildPathTagCandidates = (pathTokens: string[]): SuggestedTagCandidate[] =>
  uniqueByValue(
    pathTokens
      .map((token, index) => normalizeTagValue(token))
      .filter(keepKeyword)
      .slice(0, 8)
      .map((token, index) => ({
        value: token,
        source: 'path' as const,
        confidence: 0.72 - index * 0.03
      }))
  );

export const buildNeighborTagCandidates = (
  candidates: NeighborCandidateInput[]
): SuggestedTagCandidate[] =>
  uniqueByValue(
    candidates
      .map((candidate) => ({
        value: normalizeTagValue(candidate.tag),
        source: 'neighbor' as const,
        confidence: Math.max(0.55, Math.min(0.95, candidate.score))
      }))
      .filter((candidate) => keepKeyword(candidate.value))
  ).slice(0, 8);

export const mergeSuggestedTagCandidates = (params: {
  existingTags: string[];
  existingCollections: string[];
  candidates: SuggestedTagCandidate[];
}): SuggestedTagCandidate[] => {
  const blocked = new Set(
    [...params.existingTags, ...params.existingCollections].map((value) => normalizeTagValue(value))
  );

  return uniqueByValue(
    params.candidates
      .map((candidate) => ({
        ...candidate,
        value: normalizeTagValue(candidate.value)
      }))
      .filter((candidate) => keepKeyword(candidate.value) && !blocked.has(candidate.value))
  ).slice(0, 12);
};
