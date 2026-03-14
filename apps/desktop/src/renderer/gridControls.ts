export const MIN_GRID_COLUMNS = 2;
export const MAX_GRID_COLUMNS = 10;
export const DEFAULT_GRID_COLUMNS = 6;

export const clampGridColumns = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_GRID_COLUMNS;
  }

  return Math.min(MAX_GRID_COLUMNS, Math.max(MIN_GRID_COLUMNS, Math.round(value)));
};

export const formatGridColumnsLabel = (value: number): string =>
  `${clampGridColumns(value)} up`;
