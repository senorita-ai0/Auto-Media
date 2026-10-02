import "dotenv/config";

let poolPromise = null;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

async function getPool() {
  if (!databaseConfigured()) {
    throw new Error("PostgreSQL is not configured. Set DATABASE_URL to enable the Auto-Media Studio API.");
  }
  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }));
  }
  return poolPromise;
}

export async function query(text, values = []) {
  const pool = await getPool();
  return pool.query(text, values);
}

export async function closeDatabase() {
  if (!poolPromise) return;
  const pool = await poolPromise;
  await pool.end();
  poolPromise = null;
}

export async function databaseHealth() {
  if (!databaseConfigured()) {
    return { configured: false, connected: false };
  }
  try {
    const result = await query("SELECT 1 AS ok");
    return { configured: true, connected: result.rows[0]?.ok === 1 };
  } catch (error) {
    return { configured: true, connected: false, error: error.message };
  }
}
