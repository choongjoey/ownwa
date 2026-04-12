import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseWhatsAppArchive, parseWhatsAppArchiveFile } from "../src/lib.js";

describe("parseWhatsAppArchive", () => {
  it("parses multiline exports and marks the caller as me", async () => {
    const transcript = [
      "12/31/24, 9:30 PM - Joey: Happy new year soon",
      "Still wrapping up planning notes",
      "12/31/24, 9:31 PM - Alex: See you there"
    ].join("\n");

    const parsed = await parseWhatsAppArchive("WhatsApp Chat with Alex.txt", Buffer.from(transcript), "Joey");

    expect(parsed.chatTitle).toBe("Alex");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].content).toContain("planning notes");
    expect(parsed.messages[0].isMe).toBe(true);
    expect(parsed.messages[0].messageKind).toBe("message");
    expect(parsed.messages[0].timestampIso).toContain("2024-12-31T21:30");
  });

  it("extracts transcript and attachments from zip exports", async () => {
    const zip = new JSZip();
    zip.file(
      "WhatsApp Chat with Project Room.txt",
      "31/12/2024, 21:30 - Alex: IMG-20241231-WA0001.jpg\n31/12/2024, 21:31 - Joey: Nice shot"
    );
    zip.file("IMG-20241231-WA0001.jpg", Buffer.from("fake-jpg-data"));

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const parsed = await parseWhatsAppArchive("Project Room.zip", buffer, "Joey");

    expect(parsed.withMedia).toBe(true);
    expect(parsed.chatTitle).toBe("Project Room");
    expect(parsed.messages[0].attachments).toHaveLength(1);
    expect(parsed.messages[0].attachments[0]?.fileName).toBe("IMG-20241231-WA0001.jpg");
    expect(parsed.messages[0].attachments[0]?.contentSha256).toBeTruthy();
  });

  it("parses zip exports from disk without closing the archive early", async () => {
    const zip = new JSZip();
    zip.file(
      "WhatsApp Chat with Project Room.txt",
      "31/12/2024, 21:30 - Alex: IMG-20241231-WA0001.jpg\n31/12/2024, 21:31 - Joey: Nice shot"
    );
    zip.file("IMG-20241231-WA0001.jpg", Buffer.from("fake-jpg-data"));

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ownwa-parser-"));
    const zipPath = path.join(tempDir, "Project Room.zip");
    try {
      await writeFile(zipPath, buffer);
      const parsed = await parseWhatsAppArchiveFile("Project Room.zip", zipPath, "Joey");

      expect(parsed.withMedia).toBe(true);
      expect(parsed.chatTitle).toBe("Project Room");
      expect(parsed.messages[0].attachments).toHaveLength(1);
      expect(parsed.messages[0].attachments[0]?.fileName).toBe("IMG-20241231-WA0001.jpg");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("derives chat titles from WhatsApp Chat dash naming and classifies events", async () => {
    const transcript = [
      "[06/04/2026, 17:07:11] Rex: \u200eMessages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.",
      "[06/04/2026, 17:07:11] Rex: \u200eRex is a contact.",
      "[06/04/2026, 17:07:08] Rex: \u200eVoice call, \u200e4 min",
      "[07/04/2026, 10:21:26] Rex: \u200eMissed voice call, \u200eTap to call back"
    ].join("\n");

    const parsed = await parseWhatsAppArchive("WhatsApp Chat - Rex.txt", Buffer.from(transcript), "Joey");

    expect(parsed.chatTitle).toBe("Rex");
    expect(parsed.messages.map((message) => message.messageKind)).toEqual([
      "event",
      "event",
      "event",
      "event"
    ]);
    expect(parsed.messages.map((message) => message.eventType)).toEqual([
      "system",
      "system",
      "call",
      "call"
    ]);
    expect(parsed.messages[0]?.content).not.toContain("\u200e");
  });

  it("treats bracketed lines with hidden control marks as new messages", async () => {
    const transcript = [
      "[05/11/2024, 20:33:00] Elsie Choong: next time can teach me",
      "\u200e[05/11/2024, 20:34:03] Joey: One person one <attached: 00000108-PHOTO-2024-11-05-20-34-03.jpg>",
      "\u200e[05/11/2024, 20:42:26] Alicia Choong: <attached: 00000109-STICKER-2024-11-05-20-42-26.webp>"
    ].join("\n");

    const parsed = await parseWhatsAppArchive("WhatsApp Chat with Family.txt", Buffer.from(transcript), "Joey");

    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages.map((message) => message.sender)).toEqual([
      "Elsie Choong",
      "Joey",
      "Alicia Choong"
    ]);
    expect(parsed.messages[0]?.content).toBe("next time can teach me");
    expect(parsed.messages[1]?.content).toContain("One person one");
    expect(parsed.messages[1]?.isMe).toBe(true);
  });

  it("infers a human chat title when the file name is generic", async () => {
    const transcript = [
      "[05/11/2024, 20:33:00] Elsie Choong: next time can teach me",
      "[05/11/2024, 20:42:26] Alicia Choong: okay",
      "[05/11/2024, 20:43:02] Joey: sure"
    ].join("\n");

    const parsed = await parseWhatsAppArchive("_chat.txt", Buffer.from(transcript), "Joey");

    expect(parsed.chatTitle).toBe("Elsie Choong and Alicia Choong");
    expect(parsed.normalizedChatTitle).toBe("elsie choong and alicia choong");
  });
});
