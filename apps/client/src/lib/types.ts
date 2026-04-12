export type User = {
  id: string;
  username: string;
  createdAt: string;
};

export type Settings = {
  selfDisplayName: string;
};

export type ImportProgress = {
  task: string;
  percent: number;
};

export type ImportItem = {
  id: string;
  fileName: string;
  chatTitle: string;
  normalizedChatTitle: string;
  status: "pending" | "processing" | "completed" | "failed";
  sourceSize: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  progress: Partial<ImportProgress> | Record<string, unknown>;
  parseSummary: Record<string, unknown>;
  errorMessage: string | null;
};

export type ChatItem = {
  id: string;
  title: string;
  displayTitle: string;
  sourceTitle: string;
  titleOverridden: boolean;
  normalizedTitle: string;
  messageCount: number;
  attachmentCount: number;
  lastMessageAt: string | null;
  updatedAt: string;
};

export type SenderStat = {
  sender: string;
  total: number;
};

export type ChatDetail = {
  id: string;
  title: string;
  displayTitle: string;
  sourceTitle: string;
  titleOverridden: boolean;
  normalizedTitle: string;
  createdAt: string;
  updatedAt: string;
  stats: {
    messageCount: number;
    attachmentMessageCount: number;
    senders: SenderStat[];
  };
};

export type AttachmentSummary = {
  id: string;
  fileName: string;
  mimeType: string | null;
  byteSize: number;
  hasBlob: boolean;
  placeholderText: string | null;
  mediaKind: "image" | "video" | "sticker" | "file";
  isAnimated: boolean;
  previewUrl: string | null;
  contentUrl: string | null;
};

export type MessageItem = {
  id: string;
  chatId: string;
  sender: string;
  normalizedSender: string;
  timestamp: string | null;
  rawTimestampLabel: string;
  body: string;
  isMe: boolean;
  messageKind: "message" | "event";
  eventType: "system" | "call" | null;
  hasAttachments: boolean;
  attachments: AttachmentSummary[];
};

export type MessagePage = {
  total: number;
  limit: number;
  startOffset: number;
  hasOlder: boolean;
  hasNewer: boolean;
  nextOlderOffset: number | null;
};

export type SearchResult = MessageItem & {
  chatTitle: string;
  sourceTitle: string;
};

export type MediaViewerItem = {
  attachment: AttachmentSummary;
  chatTitle: string;
  sender: string;
  timestamp: string | null;
};
