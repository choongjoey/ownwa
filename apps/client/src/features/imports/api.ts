import { api } from "../../lib/api";
import type { ImportItem } from "../../lib/types";

export async function createImportRequest(file: File): Promise<ImportItem> {
  const formData = new FormData();
  formData.append("file", file);
  const payload = await api<{ import: ImportItem }>("/api/imports", {
    method: "POST",
    body: formData
  });
  return payload.import;
}

export async function fetchImportRequest(importId: string): Promise<ImportItem> {
  const payload = await api<{ import: ImportItem }>(`/api/imports/${importId}`);
  return payload.import;
}

export async function retryImportRequest(importId: string): Promise<ImportItem> {
  const payload = await api<{ import: ImportItem }>(`/api/imports/${importId}/retry`, {
    method: "POST"
  });
  return payload.import;
}

export async function clearImportRequest(importId: string): Promise<void> {
  await api(`/api/imports/${importId}`, {
    method: "DELETE"
  });
}
