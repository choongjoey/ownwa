import type { ImportItem, ImportProgress } from "../../lib/types";

export function clampImportPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getImportProgress(item: ImportItem): ImportProgress | null {
  const rawProgress = item.progress;
  const task = typeof rawProgress?.task === "string" ? rawProgress.task.trim() : "";
  const percentValue =
    typeof rawProgress?.percent === "number"
      ? rawProgress.percent
      : typeof rawProgress?.percent === "string"
        ? Number(rawProgress.percent)
        : Number.NaN;

  if (task && Number.isFinite(percentValue)) {
    return {
      task,
      percent: clampImportPercent(percentValue)
    };
  }

  if (item.status === "pending") {
    return {
      task: "Queued",
      percent: 0
    };
  }

  if (item.status === "processing") {
    return {
      task: "Processing import",
      percent: 0
    };
  }

  return null;
}
