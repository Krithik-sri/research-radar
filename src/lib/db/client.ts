import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/config/env";
import * as schema from "./schema";

/**
 * Drizzle client over Neon's HTTP driver — ideal for serverless (no pooling
 * connection to keep alive). Each query is a stateless HTTP request.
 */
const sql = neon(env.databaseUrl);
export const db = drizzle(sql, { schema });

export { schema };
