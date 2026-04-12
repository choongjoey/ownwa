import type { ReactNode } from "react";
import type { ImportItem, ImportProgress } from "../lib/types";

export function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.45rem] border border-white/65 bg-white/72 p-4 shadow-[0_14px_30px_rgba(64,55,39,0.06)]">
      <div className="text-sm font-semibold text-[#1f2923]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[#647068]">{body}</p>
    </div>
  );
}

export function SidebarMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1rem] border border-white/60 bg-white/72 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-[#7a847c]">{label}</div>
      <div className="mt-1.5 text-sm font-semibold text-[#1f2923]">{value}</div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#68746c]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="archive-input w-full"
      />
    </label>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.4rem] border border-white/62 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(64,55,39,0.06)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6f7a72]">{label}</div>
      <div className="mt-2 text-[1.55rem] font-extrabold tracking-[-0.04em] text-[#18211c]">{value}</div>
    </div>
  );
}

export function InfoTile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.3rem] border border-white/62 bg-white/72 p-4 shadow-[0_14px_28px_rgba(64,55,39,0.06)]">
      <div className="text-sm font-semibold text-[#1e2822]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[#66726c]">{body}</p>
    </div>
  );
}

export function InstructionCard({
  step,
  tone,
  title,
  body
}: {
  step: string;
  tone: "green" | "peach";
  title: string;
  body: string;
}) {
  const circleClasses = tone === "green" ? "bg-[#d1efe1] text-[#236545]" : "bg-[#ffd9cb] text-[#834322]";

  return (
    <div className="rounded-[1.7rem] bg-[#f2f4ef] p-5">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${circleClasses}`}>
          {step}
        </div>
        <div className="text-lg font-bold tracking-[-0.03em] text-[#1e2722]">{title}</div>
      </div>
      <p className="mt-4 text-sm leading-7 text-[#66736c]">{body}</p>
    </div>
  );
}

export function ImportProgressPanel({
  progress,
  compact = false
}: {
  progress: ImportProgress;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-3" : "mt-5 rounded-[1.3rem] border border-[#dde6d9] bg-[#f7faf5] p-4"}>
      <div className="flex items-center justify-between gap-3">
        <div className={`font-semibold text-[#214132] ${compact ? "text-xs" : "text-sm"}`}>{progress.task}</div>
        <div className={`font-semibold text-[#2c6a47] ${compact ? "text-[11px]" : "text-sm"}`}>{progress.percent}%</div>
      </div>
      <div className={`overflow-hidden rounded-full bg-[#dfe8dd] ${compact ? "mt-2 h-1.5" : "mt-3 h-2.5"}`}>
        <div
          className="h-full rounded-full bg-[#2b8a57] transition-[width] duration-300 ease-out"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

export function StatusPill({
  status,
  compact = false
}: {
  status: ImportItem["status"];
  compact?: boolean;
}) {
  const classes =
    status === "completed"
      ? "bg-[#e2f4e7] text-[#207043]"
      : status === "failed"
        ? "bg-[#ffe8e4] text-[#a74e39]"
        : status === "processing"
          ? "bg-[#fff1de] text-[#9b6221]"
          : "bg-[#e5eef8] text-[#396598]";

  return (
    <span
      className={`rounded-full px-3 py-1 font-semibold uppercase tracking-[0.18em] ${compact ? "text-[10px]" : "text-xs"} ${classes}`}
    >
      {status}
    </span>
  );
}

export function InlineAlert({ children, tone }: { children: ReactNode; tone: "error" | "info" }) {
  return (
    <div
      className={`rounded-[1.2rem] border px-4 py-3 text-sm ${
        tone === "error"
          ? "border-[#f0cbc5] bg-[#fff2ef] text-[#9a4d3e]"
          : "border-[#cfe3ef] bg-[#eff8fc] text-[#3f6d82]"
      }`}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  compact = false
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-[1.35rem] border border-dashed border-[#d8ddd4] bg-white/62 text-sm text-[#65726a] ${
        compact ? "p-4" : "p-5"
      }`}
    >
      <div className="font-semibold text-[#1f2a23]">{title}</div>
      <p className="mt-2 leading-6">{body}</p>
    </div>
  );
}

export function LoadingScreen({
  label,
  fullScreen = false
}: {
  label: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      className={`archive-card archive-card-strong flex items-center justify-center p-8 ${
        fullScreen ? "min-h-[calc(100vh-2rem)]" : "m-4 min-h-[28rem]"
      }`}
    >
      <div className="space-y-4 text-center">
        <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-[#c8d8cb] border-t-[#2c6c52]" />
        <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#557464]">{label}</div>
      </div>
    </div>
  );
}

export function Icon({
  name,
  className
}: {
  name:
    | "archive"
    | "arrow-left"
    | "check"
    | "close"
    | "edit"
    | "file"
    | "image"
    | "lock"
    | "logout"
    | "play"
    | "search"
    | "spark"
    | "upload"
    | "video";
  className?: string;
}) {
  const commonProps = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24"
  };

  switch (name) {
    case "archive":
      return (
        <svg {...commonProps}>
          <rect x="3" y="5" width="18" height="4" rx="1" />
          <path d="M5 9h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9Z" />
          <path d="M10 13h4" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...commonProps}>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
      );
    case "check":
      return (
        <svg {...commonProps}>
          <path d="m4 12 4 4 5-5" />
          <path d="m13 11 4 4 3-3" />
        </svg>
      );
    case "close":
      return (
        <svg {...commonProps}>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </svg>
      );
    case "edit":
      return (
        <svg {...commonProps}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case "file":
      return (
        <svg {...commonProps}>
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v5h5" />
        </svg>
      );
    case "image":
      return (
        <svg {...commonProps}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m21 16-5-5L5 20" />
        </svg>
      );
    case "lock":
      return (
        <svg {...commonProps}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 1 1 8 0v3" />
        </svg>
      );
    case "logout":
      return (
        <svg {...commonProps}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      );
    case "play":
      return (
        <svg {...commonProps}>
          <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "search":
      return (
        <svg {...commonProps}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "spark":
      return (
        <svg {...commonProps}>
          <path d="M12 3v6" />
          <path d="M12 15v6" />
          <path d="m6 6 4 4" />
          <path d="m14 14 4 4" />
          <path d="M3 12h6" />
          <path d="M15 12h6" />
          <path d="m6 18 4-4" />
          <path d="m14 10 4-4" />
        </svg>
      );
    case "upload":
      return (
        <svg {...commonProps}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      );
    case "video":
      return (
        <svg {...commonProps}>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="m16 10 5-3v10l-5-3Z" />
        </svg>
      );
  }
}
