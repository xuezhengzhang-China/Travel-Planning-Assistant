import { Injectable } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  databaseConnectionTimeoutMs: number;
  databaseQueryTimeoutMs: number;
}

function positiveInteger(value: string, name: string, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} is outside the supported range`);
  }
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  const corsOrigins = (env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) throw new Error('CORS_ORIGIN cannot be empty');
  for (const origin of corsOrigins) {
    let valid = false;
    try {
      const url = new URL(origin);
      valid = ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
    } catch {
      valid = false;
    }
    if (!valid) throw new Error('CORS_ORIGIN must contain HTTP or HTTPS origins');
  }
  return {
    port: positiveInteger(env.PORT ?? '3000', 'PORT', 65535),
    databaseUrl,
    corsOrigins,
    databaseConnectionTimeoutMs: positiveInteger(
      env.DB_CONNECTION_TIMEOUT_MS ?? '2000',
      'DB_CONNECTION_TIMEOUT_MS',
      60000,
    ),
    databaseQueryTimeoutMs: positiveInteger(
      env.DB_QUERY_TIMEOUT_MS ?? '10000',
      'DB_QUERY_TIMEOUT_MS',
      60000,
    ),
  };
}

@Injectable()
export class ConfigService {
  readonly values: AppConfig;

  constructor() {
    // src/config and dist/config have the same depth below the workspace root.
    loadEnv({ path: resolve(__dirname, '../../../..', '.env') });
    this.values = readConfig(process.env);
  }
}
