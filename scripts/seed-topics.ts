import "./_env";
import { db } from "@/lib/db/client";
import { topics } from "@/lib/db/schema";
import { TOPICS } from "@/config/topics";
import { sql } from "drizzle-orm";

async function main() {
  console.log(`Seeding ${TOPICS.length} topics...`);
  for (const t of TOPICS) {
    await db
      .insert(topics)
      .values({ slug: t.slug, name: t.name, description: t.description })
      .onConflictDoUpdate({
        target: topics.slug,
        set: { name: sql`excluded.name`, description: sql`excluded.description` },
      });
  }
  console.log("✅ Topics seeded.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
