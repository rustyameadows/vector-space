import { describe, expect, it } from 'vitest';
import {
  getAdjacentViewerAssetId,
  getViewerAssetIndex,
  shouldBlockViewerKeyboardNavigation,
  viewerAssetStillVisible
} from './assetViewer';

const assets = [{ id: 'asset-1' }, { id: 'asset-2' }, { id: 'asset-3' }];

describe('assetViewer helpers', () => {
  it('resolves the current asset index in filtered asset order', () => {
    expect(getViewerAssetIndex('asset-2', assets)).toBe(1);
    expect(getViewerAssetIndex('missing', assets)).toBe(-1);
  });

  it('returns previous and next asset ids using the filtered order', () => {
    expect(getAdjacentViewerAssetId('asset-2', assets, 'previous')).toBe('asset-1');
    expect(getAdjacentViewerAssetId('asset-2', assets, 'next')).toBe('asset-3');
  });

  it('clamps navigation at the first and last asset', () => {
    expect(getAdjacentViewerAssetId('asset-1', assets, 'previous')).toBe('asset-1');
    expect(getAdjacentViewerAssetId('asset-3', assets, 'next')).toBe('asset-3');
  });

  it('detects when the current viewer asset disappears from the filtered list', () => {
    expect(viewerAssetStillVisible('asset-2', assets)).toBe(true);
    expect(viewerAssetStillVisible('asset-2', [{ id: 'asset-1' }, { id: 'asset-3' }])).toBe(
      false
    );
  });

  it('blocks keyboard navigation when focus is inside editable controls', () => {
    expect(shouldBlockViewerKeyboardNavigation({ tagName: 'input' } as never)).toBe(true);
    expect(
      shouldBlockViewerKeyboardNavigation({
        tagName: 'div',
        closest: (selector: string) => (selector.includes('textarea') ? {} : null)
      } as never)
    ).toBe(true);
    expect(shouldBlockViewerKeyboardNavigation({ tagName: 'button' } as never)).toBe(false);
    expect(shouldBlockViewerKeyboardNavigation({ tagName: 'div' } as never)).toBe(false);
  });
});
