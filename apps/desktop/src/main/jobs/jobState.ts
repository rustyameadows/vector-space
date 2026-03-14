import type { IndexJobView } from '../types/domain';

export type IndexJobHistoryEntry = IndexJobView & { rowId?: number };

const compareIndexJobs = (left: IndexJobHistoryEntry, right: IndexJobHistoryEntry) => {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtOrder !== 0) {
    return updatedAtOrder;
  }

  return (right.rowId ?? 0) - (left.rowId ?? 0);
};

export const collapseIndexJobHistory = <T extends IndexJobHistoryEntry>(rows: T[]): T[] => {
  const latestJobs = new Map<string, T>();

  rows
    .slice()
    .sort(compareIndexJobs)
    .forEach((row) => {
      const key = `${row.assetId}:${row.stage}`;
      if (!latestJobs.has(key)) {
        latestJobs.set(key, row);
      }
    });

  return Array.from(latestJobs.values()).sort(compareIndexJobs);
};

export const collectInterruptedJobRowIds = (rows: Array<IndexJobView & { rowId: number }>) =>
  collapseIndexJobHistory(rows)
    .filter((row) => row.status === 'running')
    .map((row) => row.rowId);
