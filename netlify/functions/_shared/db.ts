import { neon } from '@neondatabase/serverless';

/** Minimal database interface: parameterised queries only ($1, $2, …). */
export interface Db {
  query<Row>(text: string, params?: readonly unknown[]): Promise<Row[]>;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL_READ is not set');
    this.name = 'DatabaseNotConfiguredError';
  }
}

let client: Db | undefined;
let testOverride: Db | undefined;

/**
 * The read-only Neon connection (HTTP driver: one fetch per query, suited to serverless).
 * Functions only ever receive DATABASE_URL_READ, the read-only role.
 */
export function getDb(): Db {
  if (testOverride) return testOverride;
  if (client) return client;
  const url = process.env.DATABASE_URL_READ;
  if (!url) throw new DatabaseNotConfiguredError();
  const sql = neon(url);
  client = {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      return (await sql.query(text, [...params])) as Row[];
    },
  };
  return client;
}

/** Tests inject an in-process PGlite database here. */
export function setDbForTesting(db: Db | undefined): void {
  testOverride = db;
}
