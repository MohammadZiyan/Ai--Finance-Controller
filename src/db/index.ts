import "dotenv/config";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as unknown as {
  __arenaNextJsPostgresqlPool?: Pool;
  __financePglite?: PGlite;
  __financeDb?: any;
};

const INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "reconciliation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_name" text NOT NULL,
	"source_type" text DEFAULT 'synthetic' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"rule_processing_ms" integer DEFAULT 0 NOT NULL,
	"ai_processing_ms" integer DEFAULT 0 NOT NULL,
	"total_processing_ms" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "bank_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE cascade,
	"bank_transaction_id" text NOT NULL,
	"transaction_date" date NOT NULL,
	"value_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"transaction_type" text NOT NULL,
	"account_number_masked" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"normalized_reference" text,
	"synthetic_txn_id" text
);
CREATE TABLE IF NOT EXISTS "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE cascade,
	"ledger_entry_id" text NOT NULL,
	"transaction_date" date NOT NULL,
	"description" text NOT NULL,
	"invoice_number" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"accounting_category" text NOT NULL,
	"vendor" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"normalized_reference" text,
	"synthetic_txn_id" text
);
CREATE TABLE IF NOT EXISTS "payment_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE cascade,
	"payment_id" text NOT NULL,
	"payment_date" date NOT NULL,
	"merchant" text NOT NULL,
	"reference" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" text NOT NULL,
	"settlement_date" date NOT NULL,
	"fee_amount" numeric(14, 2),
	"normalized_merchant" text NOT NULL,
	"normalized_reference" text,
	"synthetic_txn_id" text
);
CREATE TABLE IF NOT EXISTS "reconciliation_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE cascade,
	"transaction_id" text NOT NULL,
	"bank_record_id" integer REFERENCES "bank_transactions"("id") ON DELETE set null,
	"ledger_record_id" integer REFERENCES "ledger_entries"("id") ON DELETE set null,
	"payment_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"decision_method" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"expected_status" text,
	"is_correct" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE cascade,
	"exception_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"exception_type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"amount_difference" numeric(14, 2),
	"date_difference_days" integer,
	"reason" text NOT NULL,
	"recommended_action" text NOT NULL,
	"source_records" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"human_decision" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "audit_trail" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL REFERENCES "reconciliation_runs"("id") ON DELETE cascade,
	"transaction_id" text NOT NULL,
	"stage" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
`;

function cleanupStaleLock(dir: string) {
  try {
    const pidFile = path.resolve(dir, "postmaster.pid");
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {
    // Ignore cleanup error
  }
}

let initPromise: Promise<void> | null = null;

export async function ensureDbReady(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const isPostgres = Boolean(
      databaseUrl &&
        (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://"))
    );

    if (isPostgres) {
      const p = globalForDb.__arenaNextJsPostgresqlPool;
      if (p) {
        try {
          await p.query(INIT_SCHEMA_SQL);
        } catch (err: any) {
          // If concurrent sequence creation occurred (code 23505), ignore safely
          if (err?.code !== "23505") {
            throw err;
          }
        }
      }
    } else {
      const pglite = globalForDb.__financePglite;
      if (pglite) {
        await pglite.exec(INIT_SCHEMA_SQL);
      }
    }
  })();

  return initPromise;
}

function getDbInstance() {
  if (globalForDb.__financeDb) {
    return globalForDb.__financeDb;
  }

  const isPostgres = Boolean(
    databaseUrl &&
      (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://"))
  );

  if (isPostgres) {
    try {
      const pool =
        globalForDb.__arenaNextJsPostgresqlPool ??
        new Pool({
          connectionString: databaseUrl,
        });

      if (process.env.NODE_ENV !== "production") {
        globalForDb.__arenaNextJsPostgresqlPool = pool;
      }

      const dbInstance = drizzleNodePg(pool, { schema });
      globalForDb.__financeDb = dbInstance;

      // Ensure tables exist on background initialization
      ensureDbReady().catch((err) => {
        console.warn("PostgreSQL schema initialization notice:", err?.message || err);
      });

      return dbInstance;
    } catch (err) {
      console.warn("PostgreSQL connection error, falling back to embedded PGlite:", err);
    }
  }

  // Embedded PGlite fallback for zero-dependency local runs
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (isBuild) {
    const dummyProxy: any = new Proxy({}, {
      get: () => () => Promise.resolve([]),
    });
    return dummyProxy;
  }

  let pglite: PGlite;
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const pglitePath = path.resolve(dataDir, "pgdata");
    
    // Auto-clean stale lockfile from unclean shutdowns
    cleanupStaleLock(pglitePath);

    try {
      pglite = globalForDb.__financePglite ?? new PGlite(pglitePath);
    } catch (err) {
      console.warn("PGlite data directory recovery needed. Resetting database folder:", err);
      try {
        fs.rmSync(pglitePath, { recursive: true, force: true });
        pglite = new PGlite(pglitePath);
      } catch {
        pglite = new PGlite();
      }
    }

  globalForDb.__financePglite = pglite;

  // Initiate schema initialization at runtime (skip during static build analysis)
  if (!isBuild) {
    pglite.exec(INIT_SCHEMA_SQL).catch((err) => {
      console.warn("Embedded database schema initialization notice:", err?.message || err);
    });
  }

  const dbInstance = drizzlePglite(pglite, { schema });
  globalForDb.__financeDb = dbInstance;
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__financePglite) {
    try {
      await globalForDb.__financePglite.close();
    } catch {
      // Ignore close error
    }
    delete globalForDb.__financePglite;
    delete globalForDb.__financeDb;
  }
  if (globalForDb.__arenaNextJsPostgresqlPool) {
    try {
      await globalForDb.__arenaNextJsPostgresqlPool.end();
    } catch {
      // Ignore end error
    }
    delete globalForDb.__arenaNextJsPostgresqlPool;
    delete globalForDb.__financeDb;
  }
}

export const db: ReturnType<typeof drizzleNodePg> = getDbInstance() as any;
export const pool = globalForDb.__arenaNextJsPostgresqlPool;
export const isUsingPostgres = Boolean(databaseUrl && (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")));


