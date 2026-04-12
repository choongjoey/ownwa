import type { ChangeEvent, DragEvent } from "react";
import { Link } from "react-router-dom";
import { SidebarMetric, Icon, ImportProgressPanel, InstructionCard, StatusPill } from "../../components/ui";
import { formatBytes } from "../../lib/format";
import type { ImportItem } from "../../lib/types";
import { getImportProgress } from "./progress";

type ImportSummary = {
  chatCount: number;
  importCount: number;
  messageCount: number;
  attachmentCount: number;
};

type ImportModalProps = {
  file: File | null;
  imports: ImportItem[];
  summary: ImportSummary;
  uploading: boolean;
  dragActive: boolean;
  fileInputKey: number;
  activeImportCount: number;
  importActionId: string | null;
  importActionKind: "retry" | "clear" | null;
  onClose: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onDragStateChange: (value: boolean) => void;
  onRetryImport: (importId: string) => void;
  onClearImport: (importId: string) => void;
  onSubmit: () => void;
};

export function ImportModal({
  file,
  imports,
  summary,
  uploading,
  dragActive,
  fileInputKey,
  activeImportCount,
  importActionId,
  importActionKind,
  onClose,
  onFileChange,
  onDrop,
  onDragStateChange,
  onRetryImport,
  onClearImport,
  onSubmit
}: ImportModalProps) {
  const fileId = `archive-file-input-${fileInputKey}`;
  const recentImports = imports.slice(0, 4);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#191d19]/28 px-4 py-6 backdrop-blur-[6px]">
      <div className="archive-card relative flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[2.25rem] shadow-[0_40px_90px_rgba(18,22,18,0.26)]">
        <button className="archive-icon-button absolute right-5 top-5 z-10" onClick={onClose}>
          <Icon name="close" className="h-4 w-4" />
        </button>

        <div className="soft-scrollbar flex-1 overflow-y-auto px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#61796a]">Import archive</div>
            <h2 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-[#17211b]">Import chat history</h2>
            <p className="mt-4 text-base leading-8 text-[#5d6861]">
              Bring a WhatsApp export into OwnWA and keep the archive calm, searchable, and readable.
              Supports plain transcript files and zipped exports with media.
            </p>
          </div>

          <div className="mt-7 grid gap-4 md:grid-cols-2">
            <InstructionCard
              step="1"
              tone="green"
              title="Export from WhatsApp"
              body='Open the chat in WhatsApp, choose "Export Chat", and save the resulting .txt or .zip file.'
            />
            <InstructionCard
              step="2"
              tone="peach"
              title="Upload it here"
              body="Drag the export into the dropzone or browse for the file manually to begin processing."
            />
          </div>

          <label
            htmlFor={fileId}
            onDragEnter={(event) => {
              event.preventDefault();
              onDragStateChange(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              onDragStateChange(false);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              onDragStateChange(true);
            }}
            onDrop={onDrop}
            className={`mt-7 flex cursor-pointer flex-col items-center rounded-[2rem] border-2 border-dashed px-6 py-12 text-center transition ${
              dragActive
                ? "border-[#26ab57] bg-[#eef8f0]"
                : "border-[#d9ddd4] bg-[#fbfaf5] hover:border-[#93c3a0] hover:bg-[#f8faf7]"
            }`}
          >
            <input key={fileId} id={fileId} type="file" accept=".txt,.zip" className="hidden" onChange={onFileChange} />
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#eef1ea] text-[#267245]">
              <Icon name="upload" className="h-10 w-10" />
            </div>
            <h3 className="mt-6 text-2xl font-extrabold tracking-[-0.04em] text-[#171f1a]">
              {file ? file.name : "Drag and drop files"}
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-7 text-[#69736d]">
              Supports WhatsApp history `.txt` transcripts and compressed `.zip` archives with media.
            </p>
            <span className="archive-secondary-button mt-6">Browse files</span>
            {file ? (
              <div className="mt-6 rounded-[1.2rem] bg-white/90 px-4 py-3 text-sm text-[#445048] shadow-[0_10px_24px_rgba(64,56,41,0.07)]">
                Ready to import {formatBytes(file.size)}
              </div>
            ) : null}
          </label>

          <div className="mt-7 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-[1.5rem] border border-[#ece5da] bg-white/70 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff0e6] text-[#97532c]">
                  <Icon name="lock" className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#9c5d36]">Privacy first</div>
                  <p className="mt-2 text-sm leading-6 text-[#66726c]">
                    Files are processed through your own OwnWA instance and stored as encrypted blobs.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-[#dde5dd] bg-[#f6f8f4] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#61796a]">Queue</div>
                  <div className="mt-1 text-sm font-semibold text-[#1e2a22]">
                    {activeImportCount > 0 ? `${activeImportCount} active imports` : "Queue is clear"}
                  </div>
                </div>
                <StatusPill status={activeImportCount > 0 ? "processing" : "completed"} compact />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <SidebarMetric label="Chats" value={summary.chatCount.toLocaleString()} />
                <SidebarMetric label="Imports" value={summary.importCount.toLocaleString()} />
                <SidebarMetric label="Messages" value={summary.messageCount.toLocaleString()} />
                <SidebarMetric label="Media" value={summary.attachmentCount.toLocaleString()} />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[1.6rem] bg-[#f2f4ef] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#61796a]">Recent imports</div>
                <div className="mt-1 text-sm font-semibold text-[#1e2a22]">Latest queue activity</div>
              </div>
              <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#496655]">
                {imports.length} total
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {recentImports.length === 0 ? (
                <div className="rounded-[1.1rem] border border-dashed border-[#d9ddd4] bg-white/65 px-3 py-4 text-sm text-[#748078]">
                  No imports yet. Start with a `.txt` transcript or `.zip` export above.
                </div>
              ) : (
                recentImports.map((item) => {
                  const actionActive = importActionId === item.id;
                  const progress = getImportProgress(item);
                  const isActive = item.status === "pending" || item.status === "processing";
                  if (item.status !== "failed") {
                    return (
                      <Link
                        key={item.id}
                        to={`/imports/${item.id}`}
                        className="flex items-start justify-between gap-3 rounded-[1rem] border border-white/65 bg-white/80 px-3 py-3 transition hover:-translate-y-0.5 hover:shadow-[0_14px_24px_rgba(60,54,36,0.08)]"
                        onClick={onClose}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-[#202a22]">{item.chatTitle}</div>
                          <div className="truncate text-xs text-[#7c847d]">{item.fileName}</div>
                          {isActive && progress ? <ImportProgressPanel progress={progress} compact /> : null}
                        </div>
                        <StatusPill status={item.status} compact />
                      </Link>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className="rounded-[1rem] border border-[#f0ddd7] bg-white/88 px-3 py-3 shadow-[0_10px_20px_rgba(60,54,36,0.05)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Link to={`/imports/${item.id}`} className="min-w-0 flex-1" onClick={onClose}>
                          <div className="truncate text-sm font-semibold text-[#202a22]">{item.chatTitle}</div>
                          <div className="truncate text-xs text-[#7c847d]">{item.fileName}</div>
                        </Link>
                        <StatusPill status={item.status} compact />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-full bg-[#1f6f48] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-[#165839] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={uploading || actionActive}
                          onClick={() => onRetryImport(item.id)}
                        >
                          {actionActive && importActionKind === "retry" ? "Retrying..." : "Retry"}
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-[#e6cfc7] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#965843] transition hover:bg-[#fff5f1] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={uploading || actionActive}
                          onClick={() => onClearImport(item.id)}
                        >
                          {actionActive && importActionKind === "clear" ? "Clearing..." : "Clear"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse items-center justify-between gap-3 border-t border-white/55 bg-[#f7f5ef] px-6 py-4 sm:flex-row sm:px-8">
          <button className="archive-secondary-button w-full justify-center sm:w-auto" onClick={onClose}>
            Cancel
          </button>
          <button className="archive-primary-button w-full justify-center sm:w-auto" disabled={uploading || !file} onClick={onSubmit}>
            {uploading ? "Starting import..." : "Start import"}
          </button>
        </div>
      </div>
    </div>
  );
}
