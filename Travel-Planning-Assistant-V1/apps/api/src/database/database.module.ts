import { Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { DATABASE_POOL, DatabaseService } from './database.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.values.databaseUrl,
          connectionTimeoutMillis: config.values.databaseConnectionTimeoutMs,
          query_timeout: config.values.databaseQueryTimeoutMs,
          statement_timeout: config.values.databaseQueryTimeoutMs,
        });
        const logger = new Logger('DatabasePool');
        pool.on('error', () => logger.warn('An idle database connection failed'));
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
