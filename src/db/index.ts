// Drizzle client via Neon's HTTP driver (plain fetch(), no WebSocket, no
// query engine) -- confirmed working on Cloudflare Workers via a live
// diagnostic test against production (2026-09-19), unlike Prisma's own
// engines and its Neon WebSocket adapter, both confirmed NOT to work there.
// One connection mode everywhere (local dev AND Workers) -- no more of
// db.ts's old dual-mode Accelerate-vs-adapter split, since this single
// driver works in both places.
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "");

export const db = drizzle(sql, { schema });
