import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseWhatsAppArchive } from "../src/lib.js";

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
});
