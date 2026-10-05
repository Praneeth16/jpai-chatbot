import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../types';

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'migrations'),
    path.join(here, '..', '..', 'server', 'db', 'migrations'),
    path.resolve(process.cwd(), 'server', 'db', 'migrations'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`migrations directory not found, looked in: ${candidates.join(', ')}`);
  return found;
}

/** Applies every .sql file in server/db/migrations in name order. Each file must be idempotent. */
export async function runMigrations(db: Db): Promise<void> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    try {
      await db.query(readFileSync(path.join(dir, file), 'utf8'));
      console.log(`[db] migration ${file} applied`);
    } catch (err) {
      // Fatal: the router cannot log turns or keep clarification state without these tables.
      console.error(`[db] migration ${file} failed:`, err);
      throw err;
    }
  }
}
