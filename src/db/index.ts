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

function getDbInstance() {
  if (globalForDb.__financeDb) {
    return globalForDb.__financeDb;
  }

  const usePostgres = databaseUrl && (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://"));

  if (usePostgres) {
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
      return dbInstance;
    } catch (err) {
      console.warn("PostgreSQL connection error, falling back to embedded PGlite:", err);
    }
  }

  // Embedded PGlite fallback for zero-dependency local runs
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  let pglite: PGlite;

  if (isBuild) {
    pglite = new PGlite();
  } else {
    const dataDir = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const pglitePath = path.resolve(dataDir, "pgdata");
    pglite = globalForDb.__financePglite ?? new PGlite(pglitePath);
    globalForDb.__financePglite = pglite;
  }

  // Initialize schema if not already initialized
  if (!globalForDb.__financeDb) {
    pglite.exec(INIT_SCHEMA_SQL).catch(() => undefined);
  }

  const dbInstance = drizzlePglite(pglite, { schema });
  globalForDb.__financeDb = dbInstance;
  return dbInstance;
}

export const db: ReturnType<typeof drizzleNodePg> = getDbInstance() as any;
export const pool = globalForDb.__arenaNextJsPostgresqlPool;
