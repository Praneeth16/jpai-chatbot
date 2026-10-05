import type { Appkit, Db } from '../types';

/** The AppKit Lakebase handle plus transaction(): BEGIN / COMMIT on one pooled client, ROLLBACK on error. */
export function withTransactions(lakebase: Appkit['lakebase']): Db {
  const { pool } = lakebase;
  if (!pool) return lakebase;
  return {
    query: (text, params) => lakebase.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client
          .query('ROLLBACK')
          .catch((e: unknown) => console.error('[db] rollback failed:', (e as Error).message));
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
