import { describe, expect, it } from 'vitest';
import type { Appkit } from '../types';
import { withTransactions } from './transaction';

function fakeKit() {
  const log: string[] = [];
  const client = {
    query: (t: string) => (log.push(t), Promise.resolve({ rows: [] })),
    release: () => log.push('release'),
  };
  const lakebase = {
    query: () => Promise.resolve({ rows: [] }),
    pool: { connect: () => Promise.resolve(client) },
  } as unknown as Appkit['lakebase'];
  return { log, lakebase };
}

describe('withTransactions', () => {
  it('BEGIN, work, COMMIT on one client, then releases it', async () => {
    const { log, lakebase } = fakeKit();
    await withTransactions(lakebase).transaction?.((tx) => tx.query('INSERT 1'));
    expect(log).toEqual(['BEGIN', 'INSERT 1', 'COMMIT', 'release']);
  });

  it('ROLLBACK and rethrow on error', async () => {
    const { log, lakebase } = fakeKit();
    await expect(withTransactions(lakebase).transaction?.(() => Promise.reject(new Error('nope')))).rejects.toThrow(
      'nope'
    );
    expect(log).toEqual(['BEGIN', 'ROLLBACK', 'release']);
  });

  it('without a pool it returns the plain handle (no transaction support)', () => {
    const lakebase = { query: () => Promise.resolve({ rows: [] }) } as unknown as Appkit['lakebase'];
    expect('transaction' in withTransactions(lakebase)).toBe(false);
  });
});
