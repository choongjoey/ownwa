import { Pool } from "pg";
import { createConfig, runMigrations } from "./lib.js";

const tables = [
  "message_search_tokens",
  "attachments",
  "messages",
  "participants",
  "chats",
  "imports",
  "sessions",
  "users"
];

async function clearDatabase() {
  const config = createConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });

  try {
    await runMigrations(pool);
    await pool.query(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
    // eslint-disable-next-line no-console
    console.log(`Cleared tables: ${tables.join(", ")}`);
  } finally {
    await pool.end();
  }
}

void clearDatabase().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to clear database", error);
  process.exitCode = 1;
});
