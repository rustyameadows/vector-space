import { describe, expect, it } from 'vitest';
import { collapseIndexJobHistory, collectInterruptedJobRowIds } from './jobState';

describe('jobState helpers', () => {
  it('keeps only the latest status for each asset and stage', () => {
    const jobs = collapseIndexJobHistory([
      {
        assetId: 'asset-a',
        stage: 'embedding',
        status: 'running',
        error: null,
        updatedAt: '2026-03-13T12:00:00.000Z',
        rowId: 1
      },
      {
        assetId: 'asset-a',
        stage: 'embedding',
        status: 'failed',
        error: 'old failure',
        updatedAt: '2026-03-13T12:01:00.000Z',
        rowId: 2
      },
      {
        assetId: 'asset-a',
        stage: 'embedding',
        status: 'success',
        error: null,
        updatedAt: '2026-03-13T12:02:00.000Z',
        rowId: 3
      },
      {
        assetId: 'asset-b',
        stage: 'embedding',
        status: 'failed',
        error: 'needs retry',
        updatedAt: '2026-03-13T12:03:00.000Z',
        rowId: 4
      }
    ]);

    expect(jobs).toEqual([
      expect.objectContaining({
        assetId: 'asset-b',
        status: 'failed',
        error: 'needs retry'
      }),
      expect.objectContaining({
        assetId: 'asset-a',
        status: 'success',
        error: null
      })
    ]);
  });

  it('identifies only latest running jobs as interrupted work', () => {
    const rowIds = collectInterruptedJobRowIds([
      {
        assetId: 'asset-a',
        stage: 'embedding',
        status: 'running',
        error: null,
        updatedAt: '2026-03-13T12:00:00.000Z',
        rowId: 10
      },
      {
        assetId: 'asset-b',
        stage: 'embedding',
        status: 'running',
        error: null,
        updatedAt: '2026-03-13T12:01:00.000Z',
        rowId: 11
      },
      {
        assetId: 'asset-b',
        stage: 'embedding',
        status: 'success',
        error: null,
        updatedAt: '2026-03-13T12:02:00.000Z',
        rowId: 12
      }
    ]);

    expect(rowIds).toEqual([10]);
  });
});
