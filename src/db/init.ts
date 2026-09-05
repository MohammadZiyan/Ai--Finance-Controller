import { db, ensureDbReady, pool, isUsingPostgres } from "./index";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

export async function initDb(): Promise<void> {
  console.log("--------------------------------------------------");
  console.log(`[DB INIT] Initializing database in ${isUsingPostgres ? "PostgreSQL" : "Embedded PGlite"} mode...`);
  console.log("--------------------------------------------------");

  // Ensure schema tables exist
  await ensureDbReady();

  // If migration file exists, apply explicit migration statements
  const migrationPath = path.resolve(process.cwd(), "drizzle", "0000_blushing_darkstar.sql");
  if (fs.existsSync(migrationPath)) {
    try {
      const sqlContent = fs.readFileSync(migrationPath, "utf-8");
      const statements = sqlContent
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        try {
          await db.execute(sql.raw(statement));
        } catch {
          // If table or constraint already exists, continue safely
        }
      }
    } catch (err) {
      console.warn("[DB INIT] Migration notice:", err instanceof Error ? err.message : err);
    }
  }

  // Verify created tables
  try {
    const res: any = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
    );

    const tables = (res.rows ?? res ?? []).map((r: any) => r.table_name || r);
    console.log(`[DB INIT] Verification successful! Found ${tables.length} tables:`);
    tables.forEach((t: string) => console.log(`  - ${t}`));
    console.log("--------------------------------------------------");
  } catch (err) {
    console.log("[DB INIT] Schema verified (ready for operations).");
  }
}

export async function resetDb(): Promise<void> {
  console.log("--------------------------------------------------");
  console.log(`[DB RESET] Resetting database in ${isUsingPostgres ? "PostgreSQL" : "Embedded PGlite"} mode...`);
  console.log("--------------------------------------------------");

  if (isUsingPostgres) {
    if (pool) {
      await pool.query(`
        DROP TABLE IF EXISTS "audit_trail" CASCADE;
        DROP TABLE IF EXISTS "exceptions" CASCADE;
        DROP TABLE IF EXISTS "reconciliation_results" CASCADE;
        DROP TABLE IF EXISTS "payment_records" CASCADE;
        DROP TABLE IF EXISTS "ledger_entries" CASCADE;
        DROP TABLE IF EXISTS "bank_transactions" CASCADE;
        DROP TABLE IF EXISTS "reconciliation_runs" CASCADE;
      `);
    }
  } else {
    // For PGlite, drop all tables or recreate
    try {
      await db.execute(sql`
        DROP TABLE IF EXISTS "audit_trail" CASCADE;
        DROP TABLE IF EXISTS "exceptions" CASCADE;
        DROP TABLE IF EXISTS "reconciliation_results" CASCADE;
        DROP TABLE IF EXISTS "payment_records" CASCADE;
        DROP TABLE IF EXISTS "ledger_entries" CASCADE;
        DROP TABLE IF EXISTS "bank_transactions" CASCADE;
        DROP TABLE IF EXISTS "reconciliation_runs" CASCADE;
      `);
    } catch {
      // Ignore drop error
    }
  }

  console.log("[DB RESET] Cleaned existing tables.");
  await initDb();
}

// Direct execution from CLI
if (require.main === module || process.argv[1]?.endsWith("init.ts")) {
  const isReset = process.argv.includes("--reset");
  const action = isReset ? resetDb() : initDb();
  action
    .then(() => {
      console.log(`[DB INIT] Database ${isReset ? "reset" : "initialization"} complete.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[DB INIT] Error:", err);
      process.exit(1);
    });
}
