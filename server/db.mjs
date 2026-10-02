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

export async function withTransaction(work) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work((text, values = []) => client.query(text, values));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run work while holding a PostgreSQL advisory lock on a dedicated connection.
 * The lock is released automatically when this helper finishes.
 */
export async function withAdvisoryLock(lockName, work) {
  const pool = await getPool();
  const client = await pool.connect();
  let acquired = false;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [String(lockName)]);
    acquired = Boolean(result.rows[0]?.locked);
    if (!acquired) return { acquired: false, result: null };
    const runQuery = (text, values = []) => client.query(text, values);
    const value = await work(runQuery);
    return { acquired: true, result: value };
  } finally {
    if (acquired) {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [String(lockName)]).catch(() => {});
    }
    client.release();
  }
}
