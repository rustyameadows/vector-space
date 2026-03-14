import { describe, expect, it } from 'vitest';
import { buildLibraryAssetUrl, buildThumbnailSrc } from './assetUrls';

describe('asset url helpers', () => {
  it('appends the thumbnail revision to library asset urls for cache busting', () => {
    expect(buildThumbnailSrc({
      thumbnailPath: '/tmp/library/thumb.png',
      thumbnailUpdatedAt: '2026-03-13T20:15:00.000Z'
    })).toBe(
      'app://renderer/library-asset?path=%2Ftmp%2Flibrary%2Fthumb.png&rev=2026-03-13T20%3A15%3A00.000Z'
    );
  });

  it('leaves data urls untouched in preview mode', () => {
    expect(buildThumbnailSrc({
      thumbnailPath: 'data:image/png;base64,abc123',
      thumbnailUpdatedAt: '2026-03-13T20:15:00.000Z'
    })).toBe('data:image/png;base64,abc123');
  });

  it('builds library urls without a revision when none is supplied', () => {
    expect(buildLibraryAssetUrl('/tmp/library/original.png')).toBe(
      'app://renderer/library-asset?path=%2Ftmp%2Flibrary%2Foriginal.png'
    );
  });
});
