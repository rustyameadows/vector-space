import { describe, expect, it } from 'vitest';
import {
  clampGridColumns,
  DEFAULT_GRID_COLUMNS,
  formatGridColumnsLabel,
  MAX_GRID_COLUMNS,
  MIN_GRID_COLUMNS
} from './gridControls';

describe('grid controls', () => {
  it('clamps the grid size slider to the supported range', () => {
    expect(clampGridColumns(MIN_GRID_COLUMNS - 5)).toBe(MIN_GRID_COLUMNS);
    expect(clampGridColumns(MAX_GRID_COLUMNS + 5)).toBe(MAX_GRID_COLUMNS);
    expect(clampGridColumns(5.7)).toBe(6);
  });

  it('falls back to the default grid size for invalid input', () => {
    expect(clampGridColumns(Number.NaN)).toBe(DEFAULT_GRID_COLUMNS);
    expect(clampGridColumns(Number.POSITIVE_INFINITY)).toBe(DEFAULT_GRID_COLUMNS);
  });

  it('formats the visible grid size label', () => {
    expect(formatGridColumnsLabel(DEFAULT_GRID_COLUMNS)).toBe('6 up');
  });
});
