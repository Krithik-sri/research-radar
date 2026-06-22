import "./_env";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = neon(url);

  // pgvector must exist before migrations that create vector columns/indexes.
  console.log("Ensuring pgvector extension...");
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  const db = drizzle(sql);
  console.log("Applying migrations from ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ Migrations applied.");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
