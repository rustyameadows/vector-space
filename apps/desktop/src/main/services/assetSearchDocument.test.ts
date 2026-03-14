import { describe, expect, it } from 'vitest';
import {
  buildRetrievalCaption,
  buildSearchDocument,
  buildSearchSections,
  collectPathTokens
} from './assetSearchDocument';

describe('assetSearchDocument', () => {
  it('builds a metadata-rich retrieval caption', () => {
    const caption = buildRetrievalCaption({
      title: 'Poster study',
      note: 'Focused on typography',
      tags: ['poster', 'type'],
      collections: ['archive'],
      enrichment: {
        dominantColors: ['blue', 'white'],
        orientation: 'portrait',
        aspectBucket: 'portrait',
        hasText: true
      }
    });

    expect(caption).toContain('Poster study');
    expect(caption).toContain('Tags: poster, type.');
    expect(caption).toContain('Contains readable text.');
  });

  it('builds search sections including OCR and source tokens', () => {
    const sections = buildSearchSections({
      title: 'Poster study',
      note: '',
      retrievalCaption: 'Poster study caption',
      tags: ['poster'],
      collections: ['archive'],
      ocrText: 'Summer festival 2026',
      dominantColors: ['blue'],
      orientation: 'portrait',
      aspectBucket: 'portrait',
      hasText: true,
      sourcePath: '/Users/example/Archive/Summer/poster-study.png',
      exif: { cameraModel: 'iPhone' }
    });

    expect(sections.find((section) => section.section === 'ocr')?.content).toContain(
      'Summer festival'
    );
    expect(buildSearchDocument(sections)).toContain('cameraModel');
    expect(collectPathTokens('/Users/example/Archive/Summer/poster-study.png')).toContain('summer');
  });
});
