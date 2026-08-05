import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.database, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values as SQLInputValue[]) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    const results = this.database.prepare(this.sql).all(...this.values as SQLInputValue[]) as T[];
    return { results, success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values as SQLInputValue[]);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

export class SqliteD1Adapter {
  readonly database = new DatabaseSync(':memory:');

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements: SqliteD1Statement[]): Promise<Array<{ success: true; meta: { changes: number } }>> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results: Array<{ success: true; meta: { changes: number } }> = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.database.exec(sql);
    return { count: 0, duration: 0 };
  }
}
