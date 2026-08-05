export type CommonsDatabase = Pick<D1Database, 'prepare' | 'batch' | 'exec'>;

export function requireDatabase(database: D1Database | undefined): CommonsDatabase {
  if (!database) throw new Error('Commons database binding is unavailable');
  return database;
}
