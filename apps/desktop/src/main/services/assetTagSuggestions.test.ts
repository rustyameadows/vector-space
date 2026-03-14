import { describe, expect, it } from 'vitest';
import {
  buildMetadataTagCandidates,
  buildNeighborTagCandidates,
  buildOcrTagCandidates,
  buildPathTagCandidates,
  mergeSuggestedTagCandidates
} from './assetTagSuggestions';

describe('assetTagSuggestions', () => {
  it('extracts smart tag candidates from OCR, path, metadata, and neighbors', () => {
    const candidates = mergeSuggestedTagCandidates({
      existingTags: ['blue'],
      existingCollections: ['archive'],
      candidates: [
        ...buildMetadataTagCandidates({
          dominantColors: ['blue', 'white'],
          orientation: 'portrait',
          aspectBucket: 'portrait',
          hasText: true
        }),
        ...buildOcrTagCandidates(['Summer Editorial', 'Archive Search']),
        ...buildPathTagCandidates(['archive', 'editorial', 'summer']),
        ...buildNeighborTagCandidates([
          { tag: 'poster', score: 0.88 },
          { tag: 'editorial', score: 0.83 }
        ])
      ]
    });

    expect(candidates.map((candidate) => candidate.value)).toContain('portrait');
    expect(candidates.map((candidate) => candidate.value)).toContain('summer');
    expect(candidates.map((candidate) => candidate.value)).toContain('poster');
    expect(candidates.map((candidate) => candidate.value)).not.toContain('blue');
    expect(candidates.map((candidate) => candidate.value)).not.toContain('archive');
  });
});
