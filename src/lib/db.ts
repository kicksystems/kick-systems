import { Pool, type PoolClient } from "pg";

// One connection pool per server process.
// DATABASE_URL points at Supabase's Postgres in production and at the local Postgres in development.
const globalForPool = globalThis as unknown as { __kickPool?: Pool };

export const pool =
  globalForPool.__kickPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
globalForPool.__kickPool = pool;

/**
 * Runs queries as a given user. Inside the transaction the connection takes the
 * "authenticated" role and the user's id, exactly like a Supabase request, so every
 * row level security rule in the database applies. Nothing here bypasses them.
 */
export async function asUser<T>(userId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
