// Creates tables and seeds Kathy's profile. Usage: DATABASE_URL=... npm run db:setup
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { ssl: process.env.DATABASE_SSL === "false" ? false : "require", max: 1 });

try {
  for (const file of ["schema.sql", "seed.sql"]) {
    const text = readFileSync(path.join(dir, "..", "db", file), "utf8");
    await sql.unsafe(text);
    console.log(`ran db/${file}`);
  }
  console.log("Database ready.");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
