import type { Application } from 'express';

/** Column values the app reads from Postgres (no jsonb reads). */
export type Cell = string | number | boolean | Date | null | undefined | string[] | number[];
export type Row = Record<string, Cell>;

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Db extends Queryable {
  /** Runs fn in one BEGIN / COMMIT (ROLLBACK on error). Optional: tests and simple fakes may omit it. */
  transaction?<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** The slice of pg.PoolClient used for transactions. */
export interface PoolClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  release(): void;
}

/** The slice of the AppKit instance this app uses. */
export interface Appkit {
  lakebase: Db & { pool?: { connect(): Promise<PoolClientLike> } };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}
