import JSZip from "jszip";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { newDb } from "pg-mem";
import { createApp } from "../src/app.js";

type TestApp = Awaited<ReturnType<typeof createApp>>;

async function buildZipExport(chatTitle: string, transcriptLines: string[], attachments?: Record<string, Buffer>) {
  const zip = new JSZip();
  zip.file(`WhatsApp Chat with ${chatTitle}.txt`, transcriptLines.join("\n"));
  for (const [fileName, buffer] of Object.entries(attachments || {})) {
    zip.file(fileName, buffer);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath)));
    } else {
      files.push(absolutePath);
    }
  }
  return files;
}

async function waitForImportCompletion(agent: request.SuperAgentTest, importId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const payload = await agent.get(`/api/imports/${importId}`).expect(200);
    const item = payload.body.import as { status: string };
    if (item.status === "completed") {
      return payload.body.import;
    }
    if (item.status === "failed") {
      throw new Error("Import failed during test");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Import did not complete in time");
}

async function waitForImportStatus(agent: request.SuperAgentTest, importId: string, expectedStatus: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const payload = await agent.get(`/api/imports/${importId}`).expect(200);
    const item = payload.body.import as { status: string };
    if (item.status === expectedStatus) {
      return payload.body.import;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Import did not reach status ${expectedStatus} in time`);
}

describe("ownwa app", () => {
  let testApp: TestApp;
  let blobRoot: string;
  let uploadTmpDir: string;

  beforeEach(async () => {
    const db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();
    blobRoot = await mkdtemp(path.join(os.tmpdir(), "ownwa-blobs-"));
    uploadTmpDir = await mkdtemp(path.join(os.tmpdir(), "ownwa-uploads-"));

    testApp = await createApp({
      pool: pool as never,
      startWorker: false,
      config: {
        databaseUrl: "postgres://unused/test",
        port: 4000,
        sessionSecret: "session-secret-for-tests",
        appOrigin: "http://localhost:5173",
        encryptionKey: Buffer.from("development-encryption-key-12345"),
        maxImportBytes: 10737418240,
        uploadTmpDir,
        importWorkerIntervalMs: 2000,
        importWorkerBatchSize: 10,
        largeImportThresholdBytes: 2 * 1024 ** 3,
        importProgressStepPercent: 5,
        blobDriver: "local",
        blobRoot,
        s3ForcePathStyle: false
      }
    });
  });

  afterEach(async () => {
    await testApp?.close();
    await rm(blobRoot, { recursive: true, force: true });
    await rm(uploadTmpDir, { recursive: true, force: true });
  });

  it("supports settings, imports, media dedup, search, rename, range requests, and user isolation", async () => {
    const agentOne = request.agent(testApp.app);
    const agentTwo = request.agent(testApp.app);

    await agentOne.post("/api/auth/register").send({ username: "joey", password: "supersecure" }).expect(201);
    await agentTwo.post("/api/auth/register").send({ username: "alex", password: "supersecure" }).expect(201);
    await agentOne.patch("/api/settings").send({ selfDisplayName: "Joey" }).expect(200);
    await agentOne.get("/api/settings").expect(200).expect(({ body }) => {
      expect(body.settings.selfDisplayName).toBe("Joey");
    });

    const imageBody = Buffer.from("secret image attachment body");
    const stickerBody = Buffer.from("secret sticker body");
    const videoBody = Buffer.from("0123456789-video-body");
    const firstExport = await buildZipExport(
      "Project Room",
      [
        "31/12/2024, 21:30 - Joey: Here is the plan",
        "31/12/2024, 21:31 - Alex: IMG-20241231-WA0001.jpg",
        "31/12/2024, 21:31 - Alex: STK-20241231-WA0002.webp",
        "31/12/2024, 21:31 - Alex: VID-20241231-WA0003.mp4",
        "31/12/2024, 21:32 - Joey: Searchable bridge keyword"
      ],
      {
        "IMG-20241231-WA0001.jpg": imageBody,
        "STK-20241231-WA0002.webp": stickerBody,
        "VID-20241231-WA0003.mp4": videoBody
      }
    );

    await agentOne
      .post("/api/imports")
      .attach("file", firstExport, {
        filename: "Project Room.zip",
        contentType: "application/zip"
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.import.progress.task).toBe("Queued");
        expect(body.import.progress.percent).toBe(0);
      });

    await testApp.services.processPendingImports();

    const importsPayload = await agentOne.get("/api/imports").expect(200);
    const firstImportId = importsPayload.body.imports[0].id as string;
    const completedImport = await waitForImportCompletion(agentOne, firstImportId);
    expect(completedImport.status).toBe("completed");
    expect(completedImport.progress.task).toBe("Completed");
    expect(completedImport.progress.percent).toBe(100);
    expect(completedImport.parseSummary.messagesParsed).toBe(5);

    const chatsPayload = await agentOne.get("/api/chats").expect(200);
    expect(chatsPayload.body.chats).toHaveLength(1);
    expect(chatsPayload.body.chats[0].messageCount).toBe(5);
    expect(chatsPayload.body.chats[0].displayTitle).toBe("Project Room");

    await agentTwo.get("/api/chats").expect(200).expect(({ body }) => {
      expect(body.chats).toHaveLength(0);
    });

    const chatId = chatsPayload.body.chats[0].id as string;
    const messagesPayload = await agentOne.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(messagesPayload.body.messages).toHaveLength(5);
    expect(messagesPayload.body.page.total).toBe(5);
    expect(messagesPayload.body.page.hasOlder).toBe(false);
    expect(messagesPayload.body.messages[0].body).toContain("Here is the plan");
    expect(messagesPayload.body.messages[0].isMe).toBe(true);

    const attachment = messagesPayload.body.messages[1].attachments[0];
    expect(attachment.fileName).toBe("IMG-20241231-WA0001.jpg");
    expect(messagesPayload.body.messages[2].attachments[0].mediaKind).toBe("sticker");
    expect(messagesPayload.body.messages[3].attachments[0].mediaKind).toBe("video");

    await agentTwo.get(`/api/attachments/${attachment.id}`).expect(404);
    await agentOne
      .get(`/api/attachments/${attachment.id}`)
      .buffer(true)
      .parse((res, callback) => {
        const parts: Buffer[] = [];
        res.on("data", (chunk) => parts.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(parts)));
      })
      .expect(200)
      .expect((res) => {
        expect(Buffer.compare(res.body as Buffer, imageBody)).toBe(0);
      });

    const videoAttachment = messagesPayload.body.messages[3].attachments[0];
    await agentOne
      .get(`/api/attachments/${videoAttachment.id}`)
      .set("Range", "bytes=0-5")
      .buffer(true)
      .parse((res, callback) => {
        const parts: Buffer[] = [];
        res.on("data", (chunk) => parts.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(parts)));
      })
      .expect(206)
      .expect((res) => {
        expect(res.headers["content-range"]).toBe(`bytes 0-5/${videoBody.length}`);
        expect((res.body as Buffer).toString("utf8")).toBe(videoBody.subarray(0, 6).toString("utf8"));
      });

    const searchPayload = await agentOne.get(`/api/chats/${chatId}/search?q=bridge`).expect(200);
    expect(searchPayload.body.results).toHaveLength(1);
    expect(searchPayload.body.results[0].body).toContain("bridge keyword");

    const pagedLatestMessages = await agentOne.get(`/api/chats/${chatId}/messages?limit=2`).expect(200);
    expect(pagedLatestMessages.body.messages).toHaveLength(2);
    expect(pagedLatestMessages.body.page.total).toBe(5);
    expect(pagedLatestMessages.body.page.hasOlder).toBe(true);
    expect(pagedLatestMessages.body.page.startOffset).toBe(3);
    expect(pagedLatestMessages.body.messages[0].attachments[0].mediaKind).toBe("video");
    expect(pagedLatestMessages.body.messages[1].body).toContain("bridge keyword");

    const pagedOlderMessages = await agentOne
      .get(`/api/chats/${chatId}/messages?limit=2&beforeOffset=1`)
      .expect(200);
    expect(pagedOlderMessages.body.messages).toHaveLength(2);
    expect(pagedOlderMessages.body.page.startOffset).toBe(1);
    expect(pagedOlderMessages.body.messages[0].attachments[0].fileName).toBe("IMG-20241231-WA0001.jpg");

    const eventZip = new JSZip();
    eventZip.file(
      "WhatsApp Chat - Rex.txt",
      [
        "[06/04/2026, 17:07:11] Rex: \u200eMessages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.",
        "[06/04/2026, 17:07:08] Rex: \u200eVoice call, \u200e4 min"
      ].join("\n")
    );
    const eventExport = await eventZip.generateAsync({ type: "nodebuffer" });

    await agentOne
      .post("/api/imports")
      .attach("file", eventExport, {
        filename: "WhatsApp Chat - Rex.zip",
        contentType: "application/zip"
      })
      .expect(201);
    await testApp.services.processPendingImports();
    const secondImportList = await agentOne.get("/api/imports").expect(200);
    const rexImport = (secondImportList.body.imports as Array<{ id: string; chatTitle: string }>).find(
      (item) => item.chatTitle === "Rex"
    );
    expect(rexImport?.id).toBeTruthy();
    await waitForImportCompletion(agentOne, rexImport!.id);

    const globalSearch = await agentOne.get("/api/search?q=encrypted").expect(200);
    expect(globalSearch.body.results).toHaveLength(1);
    expect(globalSearch.body.results[0].messageKind).toBe("event");
    expect(globalSearch.body.results[0].chatTitle).toBe("Rex");

    await agentOne
      .patch(`/api/chats/${chatId}`)
      .send({ displayTitle: "Project Alpha" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.chat.displayTitle).toBe("Project Alpha");
        expect(body.chat.titleOverridden).toBe(true);
      });

    await agentOne
      .patch(`/api/chats/${chatId}`)
      .send({ displayTitle: "" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.chat.displayTitle).toBe("Project Room");
        expect(body.chat.titleOverridden).toBe(false);
      });

    await agentOne
      .post("/api/imports")
      .attach("file", firstExport, {
        filename: "Project Room.zip",
        contentType: "application/zip"
      })
      .expect(409);

    const secondExport = await buildZipExport(
      "Project Room",
      [
        "31/12/2024, 21:30 - Joey: Here is the plan",
        "31/12/2024, 21:31 - Alex: IMG-20241231-WA0001.jpg",
        "31/12/2024, 21:31 - Alex: STK-20241231-WA0002.webp",
        "31/12/2024, 21:31 - Alex: VID-20241231-WA0003.mp4",
        "31/12/2024, 21:32 - Joey: Searchable bridge keyword",
        "31/12/2024, 21:33 - Alex: New line after overlap"
      ],
      {
        "IMG-20241231-WA0001.jpg": imageBody,
        "STK-20241231-WA0002.webp": stickerBody,
        "VID-20241231-WA0003.mp4": videoBody
      }
    );

    await agentOne
      .post("/api/imports")
      .attach("file", secondExport, {
        filename: "Project Room-part-2.zip",
        contentType: "application/zip"
      })
      .expect(201);

    await testApp.services.processPendingImports();
    const overlapImports = await agentOne.get("/api/imports").expect(200);
    const overlapImport = (overlapImports.body.imports as Array<{ id: string; fileName: string }>).find(
      (item) => item.fileName === "Project Room-part-2.zip"
    );
    expect(overlapImport?.id).toBeTruthy();
    await waitForImportCompletion(agentOne, overlapImport!.id);

    const messagesAfterOverlap = await agentOne.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(messagesAfterOverlap.body.messages).toHaveLength(6);
    expect(messagesAfterOverlap.body.messages[1].attachments).toHaveLength(1);
    expect(messagesAfterOverlap.body.messages[2].attachments[0].mediaKind).toBe("sticker");
    expect(messagesAfterOverlap.body.messages[3].attachments[0].mediaKind).toBe("video");

    const storedFiles = await listFiles(blobRoot);
    const attachmentBlobFiles = storedFiles.filter((filePath) => filePath.includes(`${path.sep}attachments${path.sep}`));
    expect(attachmentBlobFiles).toHaveLength(3);

    const importBlobFiles = storedFiles.filter((filePath) => filePath.includes(`${path.sep}imports${path.sep}`));
    expect(importBlobFiles.length).toBeGreaterThanOrEqual(3);

    const encryptedImportBlob = await readFile(importBlobFiles[0]);
    expect(encryptedImportBlob.toString("utf8")).not.toContain("Searchable bridge keyword");

    const encryptedAttachmentBlob = await readFile(attachmentBlobFiles[0]);
    expect(encryptedAttachmentBlob.toString("utf8")).not.toContain("secret image attachment body");
  });

  it("replaces generic chat file names with inferred participant labels", async () => {
    const agent = request.agent(testApp.app);

    await agent.post("/api/auth/register").send({ username: "joey", password: "supersecure" }).expect(201);
    await agent.patch("/api/settings").send({ selfDisplayName: "Joey" }).expect(200);

    await agent
      .post("/api/imports")
      .attach(
        "file",
        Buffer.from(
          [
            "[05/11/2024, 20:33:00] Elsie Choong: next time can teach me",
            "[05/11/2024, 20:42:26] Alicia Choong: okay",
            "[05/11/2024, 20:43:02] Joey: sure"
          ].join("\n")
        ),
        {
          filename: "_chat.txt",
          contentType: "text/plain"
        }
      )
      .expect(201);

    await testApp.services.processPendingImports();

    const importsPayload = await agent.get("/api/imports").expect(200);
    await waitForImportCompletion(agent, importsPayload.body.imports[0].id as string);

    await agent.get("/api/chats").expect(200).expect(({ body }) => {
      expect(body.chats).toHaveLength(1);
      expect(body.chats[0].displayTitle).toBe("Elsie Choong and Alicia Choong");
      expect(body.chats[0].sourceTitle).toBe("Elsie Choong and Alicia Choong");
    });
  });

  it("reports the configured upload cap when a file is too large", async () => {
    await testApp.close();

    const db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();

    testApp = await createApp({
      pool: pool as never,
      startWorker: false,
      config: {
        databaseUrl: "postgres://unused/test",
        port: 4000,
        sessionSecret: "session-secret-for-tests",
        appOrigin: "http://localhost:5173",
        encryptionKey: Buffer.from("development-encryption-key-12345"),
        maxImportBytes: 5,
        uploadTmpDir,
        importWorkerIntervalMs: 2000,
        importWorkerBatchSize: 10,
        largeImportThresholdBytes: 2 * 1024 ** 3,
        importProgressStepPercent: 5,
        blobDriver: "local",
        blobRoot,
        s3ForcePathStyle: false
      }
    });

    const agent = request.agent(testApp.app);
    await agent.post("/api/auth/register").send({ username: "joey", password: "supersecure" }).expect(201);

    await agent
      .post("/api/imports")
      .attach("file", Buffer.from("123456"), {
        filename: "WhatsApp Chat with Tiny.txt",
        contentType: "text/plain"
      })
      .expect(413)
      .expect(({ body }) => {
        expect(body.error).toContain("5 B");
      });
  });

  it("retries and clears failed imports without requiring a re-upload", async () => {
    const agent = request.agent(testApp.app);

    await agent.post("/api/auth/register").send({ username: "joey", password: "supersecure" }).expect(201);

    const invalidExport = await new JSZip().file("image.jpg", Buffer.from("not a transcript")).generateAsync({
      type: "nodebuffer"
    });

    await agent
      .post("/api/imports")
      .attach("file", invalidExport, {
        filename: "Broken Export.zip",
        contentType: "application/zip"
      })
      .expect(201);

    const importsPayload = await agent.get("/api/imports").expect(200);
    const importId = importsPayload.body.imports[0].id as string;

    await testApp.services.processPendingImports();
    const failedImport = await waitForImportStatus(agent, importId, "failed");
    expect(failedImport.errorMessage).toContain("WhatsApp transcript");

    const listImportBlobFiles = async () => {
      const storedFiles = await listFiles(blobRoot);
      return storedFiles.filter((filePath) => filePath.includes(`${path.sep}imports${path.sep}`));
    };

    const importBlobFilesBeforeRetry = await listImportBlobFiles();
    expect(importBlobFilesBeforeRetry).toHaveLength(1);

    await agent.post(`/api/imports/${importId}/retry`).expect(200).expect(({ body }) => {
      expect(body.import.id).toBe(importId);
      expect(body.import.status).toBe("pending");
      expect(body.import.progress.task).toBe("Queued");
      expect(body.import.progress.percent).toBe(0);
    });

    const importBlobFilesAfterRetry = await listImportBlobFiles();
    expect(importBlobFilesAfterRetry).toEqual(importBlobFilesBeforeRetry);

    await testApp.services.processPendingImports();
    await waitForImportStatus(agent, importId, "failed");

    await agent.delete(`/api/imports/${importId}`).expect(204);
    await agent.get(`/api/imports/${importId}`).expect(404);
    await agent.get("/api/imports").expect(200).expect(({ body }) => {
      expect(body.imports).toHaveLength(0);
    });

    const importBlobFilesAfterClear = await listImportBlobFiles();
    expect(importBlobFilesAfterClear).toHaveLength(0);
  });
});
