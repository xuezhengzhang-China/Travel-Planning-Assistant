import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async isReady(): Promise<boolean> {
    try {
      const readinessQuery = { text: 'SELECT 1', query_timeout: 2000 };
      await this.pool.query(readinessQuery);
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
