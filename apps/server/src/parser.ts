import JSZip from "jszip";
import mime from "mime-types";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import yauzl, { type Entry as ZipEntry, type ZipFile } from "yauzl";
import { sha256Hex } from "./utils/crypto.js";
import { escapeRegExp, normalizeKey, stripWhatsAppControlMarks } from "./utils/text.js";

export interface AttachmentRecord {
  fileName: string;
  normalizedName: string;
  archivePath?: string;
  sourceArchiveFilePath?: string;
  buffer?: Buffer;
  contentSha256?: string;
  byteSize: number;
  mimeType: string | null;
  placeholderText: string | null;
}

export interface ParsedMessage {
  sender: string;
  normalizedSender: string;
  rawTimestampLabel: string;
  timestampIso: string | null;
  content: string;
  isMe: boolean;
  messageKind: "message" | "event";
  eventType: "system" | "call" | null;
  attachments: AttachmentRecord[];
}

export interface ParsedArchive {
  chatTitle: string;
  normalizedChatTitle: string;
  transcriptName: string;
  withMedia: boolean;
  messages: ParsedMessage[];
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function deriveChatTitle(fileName: string): string {
  const clean = stripExtension(path.basename(fileName));
  const derived = clean
    .replace(/^WhatsApp Chat with /i, "")
    .replace(/^WhatsApp Chat\s*-\s*/i, "")
    .replace(/^Chat with /i, "")
    .trim();
  return isGenericChatTitle(derived) ? "" : derived;
}

function isGenericChatTitle(value: string): boolean {
  const normalized = normalizeKey(value.replace(/[_-]+/g, " "));
  if (!normalized) {
    return true;
  }
  if (["chat", "whatsapp chat", "conversation", "conversations", "untitled chat", "messages"].includes(normalized)) {
    return true;
  }
  return /^(?:chat|conversation|messages?)\s*\d*$/.test(normalized);
}

function inferChatTitleFromMessages(messages: ParsedMessage[]): string {
  const distinct = new Map<string, string>();

  for (const message of messages) {
    if (message.messageKind !== "message" || message.isMe || !message.normalizedSender) {
      continue;
    }
    if (!distinct.has(message.normalizedSender)) {
      distinct.set(message.normalizedSender, message.sender);
    }
  }

  const names = Array.from(distinct.values());
  if (names.length === 0) {
    return "";
  }
  if (names.length === 1) {
    return names[0] || "";
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names[0]}, ${names[1]} + ${names.length - 2}`;
}

function extractDatePart(rawTime: string): string {
  return rawTime.match(/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/)?.[0] || "";
}

function extractTimePart(rawTime: string): string {
  return rawTime.match(/\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap][Mm])?/)?.[0] || rawTime;
}

function normalizeYear(year: number): number {
  if (year < 100) {
    return year >= 70 ? 1900 + year : 2000 + year;
  }
  return year;
}

function createDateStrict(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseLabelWithOrder(label: string, order: "DMY" | "MDY" | "YMD"): Date | null {
  const rawParts = (label || "").split(/[/-]/).map((part) => part.trim());
  if (rawParts.length !== 3) {
    return null;
  }
  const [aRaw, bRaw, cRaw] = rawParts;
  const [a, b, c] = rawParts.map((part) => Number.parseInt(part, 10));
  if ([a, b, c].some((value) => Number.isNaN(value))) {
    return null;
  }
  if (order === "YMD") {
    if (aRaw.length !== 4) {
      return null;
    }
    return createDateStrict(normalizeYear(a), b, c);
  }
  if (order === "MDY") {
    return createDateStrict(normalizeYear(c), a, b);
  }
  return createDateStrict(normalizeYear(c), b, a);
}

function scoreDateOrder(labels: string[], order: "DMY" | "MDY" | "YMD"): number {
  return labels.reduce((score, label) => {
    const parsed = parseLabelWithOrder(label, order);
    return parsed ? score + 1 : score;
  }, 0);
}

function inferDateOrder(dateLabels: string[]): "DMY" | "MDY" | "YMD" {
  const filtered = dateLabels.filter(Boolean);
  const scores = {
    DMY: scoreDateOrder(filtered, "DMY"),
    MDY: scoreDateOrder(filtered, "MDY"),
    YMD: scoreDateOrder(filtered, "YMD")
  };
  if (scores.YMD > scores.DMY && scores.YMD > scores.MDY) {
    return "YMD";
  }
  if (scores.MDY > scores.DMY) {
    return "MDY";
  }
  return "DMY";
}

function parseExportTimestamp(rawLabel: string, order: "DMY" | "MDY" | "YMD"): string | null {
  const datePart = extractDatePart(rawLabel);
  const timePart = extractTimePart(rawLabel);
  const baseDate = parseLabelWithOrder(datePart, order);
  if (!baseDate) {
    return null;
  }
  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?$/);
  if (!timeMatch) {
    return baseDate.toISOString();
  }
  let [, hourRaw, minuteRaw, secondRaw, meridian] = timeMatch;
  let hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  const second = Number.parseInt(secondRaw || "0", 10);
  if (meridian) {
    const upper = meridian.toUpperCase();
    if (upper === "PM" && hour < 12) {
      hour += 12;
    }
    if (upper === "AM" && hour === 12) {
      hour = 0;
    }
  }
  baseDate.setUTCHours(hour, minute, second, 0);
  return baseDate.toISOString();
}

function extractAttachmentCandidates(content: string): string[] {
  const matches = new Set<string>();
  const genericPattern =
    /([A-Za-z0-9][A-Za-z0-9 _().-]{0,180}\.(?:jpg|jpeg|png|gif|webp|heic|mp4|mov|pdf|opus|ogg|aac|m4a|mp3|doc|docx|xls|xlsx|ppt|pptx|vcf|txt|zip))/gi;
  for (const match of content.matchAll(genericPattern)) {
    if (match[1]) {
      matches.add(path.basename(match[1].trim()));
    }
  }
  for (const match of content.matchAll(/<attached:\s*([^>]+)>/gi)) {
    if (match[1]) {
      matches.add(path.basename(match[1].trim()));
    }
  }
  return Array.from(matches);
}

function isSkippableZipEntry(entryName: string): boolean {
  return entryName.startsWith("__MACOSX");
}

function openZipFile(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        lazyEntries: true,
        autoClose: false
      },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(error || new Error("Unable to open ZIP archive"));
          return;
        }
        resolve(zipFile);
      }
    );
  });
}

function nextZipEntry(zipFile: ZipFile): Promise<ZipEntry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: ZipEntry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      zipFile.off("entry", onEntry);
      zipFile.off("end", onEnd);
      zipFile.off("error", onError);
    };
    zipFile.once("entry", onEntry);
    zipFile.once("end", onEnd);
    zipFile.once("error", onError);
    zipFile.readEntry();
  });
}

function openZipEntryStream(zipFile: ZipFile, entry: ZipEntry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error || new Error(`Unable to read ZIP entry ${entry.fileName}`));
        return;
      }
      resolve(stream);
    });
  });
}

export async function readZipEntryBuffer(zipPath: string, entryName: string): Promise<Buffer> {
  const zipFile = await openZipFile(zipPath);
  try {
    let matchedEntry: ZipEntry | null = null;
    while (true) {
      const entry = await nextZipEntry(zipFile);
      if (!entry) {
        break;
      }
      if (entry.fileName === entryName) {
        matchedEntry = entry;
        break;
      }
    }
    if (!matchedEntry) {
      throw new Error(`ZIP export is missing attachment ${path.basename(entryName)}`);
    }
    const stream = await openZipEntryStream(zipFile, matchedEntry);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.once("end", () => resolve());
      stream.once("error", reject);
    });
    return Buffer.concat(chunks);
  } finally {
    zipFile.close();
  }
}

async function scanZipArchive(fileName: string, zipPath: string) {
  const zipFile = await openZipFile(zipPath);
  try {
    let transcriptEntryName: string | null = null;
    let transcriptName = path.basename(fileName);
    let chatTitle = deriveChatTitle(fileName);
    const attachmentMap = new Map<string, AttachmentRecord>();
    let withMedia = false;

    while (true) {
      const entry = await nextZipEntry(zipFile);
      if (!entry) {
        break;
      }
      if (/\/$/.test(entry.fileName) || isSkippableZipEntry(entry.fileName)) {
        continue;
      }
      if (!transcriptEntryName && entry.fileName.toLowerCase().endsWith(".txt")) {
        transcriptEntryName = entry.fileName;
        transcriptName = path.basename(entry.fileName);
        chatTitle = deriveChatTitle(entry.fileName) || deriveChatTitle(fileName);
        continue;
      }

      withMedia = true;
      const baseName = path.basename(entry.fileName);
      attachmentMap.set(normalizeKey(baseName), {
        fileName: baseName,
        normalizedName: normalizeKey(baseName),
        archivePath: entry.fileName,
        sourceArchiveFilePath: zipPath,
        byteSize: entry.uncompressedSize,
        mimeType: mime.lookup(baseName) || "application/octet-stream",
        placeholderText: null
      });
    }

    if (!transcriptEntryName) {
      throw new Error("ZIP export does not include a WhatsApp transcript .txt");
    }

    return {
      transcriptEntryName,
      transcriptName,
      chatTitle,
      attachmentMap,
      withMedia
    };
  } finally {
    zipFile.close();
  }
}

function normalizeTranscriptLine(value: string): string {
  return stripWhatsAppControlMarks(value).replace(/^\uFEFF/, "");
}

function classifyHistoricalEvent(
  content: string,
  sender: string
): { messageKind: "message" | "event"; eventType: "system" | "call" | null; content: string } {
  const cleaned = stripWhatsAppControlMarks(content).trim();
  const normalized = normalizeKey(cleaned);
  const senderPattern = escapeRegExp(normalizeKey(sender));

  const callPatterns = [
    /^(?:missed\s+)?voice call(?:,\s*.+)?$/i,
    /^(?:missed\s+)?video call(?:,\s*.+)?$/i
  ];
  if (callPatterns.some((pattern) => pattern.test(cleaned))) {
    return {
      messageKind: "event",
      eventType: "call",
      content: cleaned
    };
  }

  const systemPatterns = [
    /messages and calls are end-to-end encrypted/i,
    /security code/i,
    /turned on disappearing messages/i,
    /turned off disappearing messages/i,
    /changed (?:the )?(?:group icon|group description|group subject|subject from)/i,
    /created group/i,
    /joined using this group's invite link/i,
    /joined using the group's invite link/i,
    /changed their phone number/i,
    /this message was deleted/i
  ];
  if (systemPatterns.some((pattern) => pattern.test(cleaned))) {
    return {
      messageKind: "event",
      eventType: "system",
      content: cleaned
    };
  }

  const senderSpecificPatterns = [
    new RegExp(`^${senderPattern} is a contact\\.?$`, "i"),
    new RegExp(`^${senderPattern} added .+$`, "i"),
    new RegExp(`^${senderPattern} removed .+$`, "i"),
    new RegExp(`^${senderPattern} left\\.?$`, "i"),
    new RegExp(`^${senderPattern} created group .+$`, "i")
  ];
  if (senderSpecificPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      messageKind: "event",
      eventType: "system",
      content: cleaned
    };
  }

  return {
    messageKind: "message",
    eventType: null,
    content: cleaned
  };
}

async function parseTranscriptInput(
  input: AsyncIterable<string>,
  transcriptName: string,
  chatTitle: string,
  attachmentMap: Map<string, AttachmentRecord>,
  withMedia: boolean,
  selfDisplayName?: string
): Promise<ParsedArchive> {
  const regex =
    /^\[?(\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?([^:]+):\s?(.*)$/;
  const rawMessages: Array<{
    rawTimestampLabel: string;
    sender: string;
    content: string;
  }> = [];
  let lastMessage: (typeof rawMessages)[number] | null = null;

  for await (const line of input) {
    const normalizedLine = normalizeTranscriptLine(line);
    const match = normalizedLine.match(regex);
    if (match) {
      const [, rawTimestampLabel, sender, content] = match;
      const message = {
        rawTimestampLabel: rawTimestampLabel.trim(),
        sender: sender.trim(),
        content: content || ""
      };
      rawMessages.push(message);
      lastMessage = message;
      continue;
    }
    if (lastMessage) {
      lastMessage.content += `\n${normalizedLine}`;
    }
  }

  const inferredOrder = inferDateOrder(rawMessages.map((message) => extractDatePart(message.rawTimestampLabel)));
  const messages = rawMessages.map<ParsedMessage>((message) => {
    const attachmentCandidates = extractAttachmentCandidates(message.content)
      .map((candidate) => attachmentMap.get(normalizeKey(candidate)))
      .filter((candidate): candidate is AttachmentRecord => Boolean(candidate))
      .map((candidate) => ({
        ...candidate,
        placeholderText: candidate.fileName
      }));
    const content = message.content.replace(/^<media omitted>$/i, "[Media omitted]");
    const classification = classifyHistoricalEvent(content, message.sender);
    return {
      sender: message.sender,
      normalizedSender: normalizeKey(message.sender),
      rawTimestampLabel: message.rawTimestampLabel,
      timestampIso: parseExportTimestamp(message.rawTimestampLabel, inferredOrder),
      content: classification.content,
      isMe: selfDisplayName
        ? normalizeKey(message.sender) === normalizeKey(selfDisplayName)
        : normalizeKey(message.sender) === "you",
      messageKind: classification.messageKind,
      eventType: classification.eventType,
      attachments: attachmentCandidates
    };
  });

  const resolvedChatTitle =
    isGenericChatTitle(chatTitle) || !chatTitle ? inferChatTitleFromMessages(messages) || "Untitled chat" : chatTitle;

  return {
    chatTitle: resolvedChatTitle,
    normalizedChatTitle: normalizeKey(resolvedChatTitle),
    transcriptName,
    withMedia,
    messages
  };
}

async function parseTranscriptText(
  transcriptText: string,
  transcriptName: string,
  chatTitle: string,
  attachmentMap: Map<string, AttachmentRecord>,
  withMedia: boolean,
  selfDisplayName?: string
): Promise<ParsedArchive> {
  async function* lines(): AsyncIterable<string> {
    yield* transcriptText.split(/\r?\n/);
  }

  return parseTranscriptInput(lines(), transcriptName, chatTitle, attachmentMap, withMedia, selfDisplayName);
}

export async function parseWhatsAppArchive(
  fileName: string,
  input: Buffer,
  selfDisplayName?: string
): Promise<ParsedArchive> {
  let transcriptText = "";
  let transcriptName = path.basename(fileName);
  let chatTitle = deriveChatTitle(fileName);
  const attachmentMap = new Map<string, AttachmentRecord>();
  const lowerName = fileName.toLowerCase();
  let withMedia = false;

  if (lowerName.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(input);
    const transcriptEntry = Object.values(zip.files).find(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".txt") && !isSkippableZipEntry(entry.name)
    );
    if (!transcriptEntry) {
      throw new Error("ZIP export does not include a WhatsApp transcript .txt");
    }
    transcriptName = path.basename(transcriptEntry.name);
    chatTitle = deriveChatTitle(transcriptEntry.name) || deriveChatTitle(fileName);
    transcriptText = await transcriptEntry.async("string");

    const attachmentEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name !== transcriptEntry.name && !isSkippableZipEntry(entry.name)
    );
    withMedia = attachmentEntries.length > 0;
    for (const entry of attachmentEntries) {
      const data = await entry.async("nodebuffer");
      const baseName = path.basename(entry.name);
      attachmentMap.set(normalizeKey(baseName), {
        fileName: baseName,
        normalizedName: normalizeKey(baseName),
        archivePath: entry.name,
        buffer: data,
        contentSha256: sha256Hex(data),
        byteSize: data.byteLength,
        mimeType: mime.lookup(baseName) || "application/octet-stream",
        placeholderText: null
      });
    }
  } else {
    transcriptText = input.toString("utf8");
  }

  return parseTranscriptText(transcriptText, transcriptName, chatTitle, attachmentMap, withMedia, selfDisplayName);
}

export async function parseWhatsAppArchiveFile(
  fileName: string,
  filePath: string,
  selfDisplayName?: string
): Promise<ParsedArchive> {
  if (!fileName.toLowerCase().endsWith(".zip")) {
    const transcriptStream = createReadStream(filePath, { encoding: "utf8" });
    const lines = createInterface({
      input: transcriptStream,
      crlfDelay: Infinity
    });
    return parseTranscriptInput(
      lines,
      path.basename(fileName),
      deriveChatTitle(fileName),
      new Map<string, AttachmentRecord>(),
      false,
      selfDisplayName
    );
  }

  const { transcriptEntryName, transcriptName, chatTitle, attachmentMap, withMedia } = await scanZipArchive(
    fileName,
    filePath
  );
  const zipFile = await openZipFile(filePath);
  try {
    let transcriptEntry: ZipEntry | null = null;
    while (true) {
      const entry = await nextZipEntry(zipFile);
      if (!entry) {
        break;
      }
      if (entry.fileName === transcriptEntryName) {
        transcriptEntry = entry;
        break;
      }
    }
    if (!transcriptEntry) {
      throw new Error("ZIP export does not include a WhatsApp transcript .txt");
    }

    const transcriptStream = await openZipEntryStream(zipFile, transcriptEntry);
    const lines = createInterface({
      input: transcriptStream.setEncoding("utf8"),
      crlfDelay: Infinity
    });
    return parseTranscriptInput(lines, transcriptName, chatTitle, attachmentMap, withMedia, selfDisplayName);
  } finally {
    zipFile.close();
  }
}
