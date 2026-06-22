import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // pgvector extension is created via a manual SQL step in scripts/migrate.ts
  verbose: true,
  strict: true,
} satisfies Config;
