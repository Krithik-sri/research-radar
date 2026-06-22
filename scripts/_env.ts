/**
 * Loads .env.local (preferred) or .env into process.env for CLI scripts.
 * Uses Node's built-in loader (Node >= 21) — no dotenv dependency needed.
 * Next.js loads these automatically at runtime; this is only for `tsx` scripts.
 */
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}
