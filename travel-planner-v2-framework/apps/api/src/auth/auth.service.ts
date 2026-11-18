import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { ConfigService } from '../config/config.service';
import { ApiError } from '../common/api-error';
import type { PublicUser } from './auth.types';

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_hash?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async register(emailInput: string, password: string, displayName: string): Promise<PublicUser> {
    const email = this.normalizeEmail(emailInput);
    if (password.length < 12 || password.length > 128) {
      throw new ApiError('VALIDATION_ERROR', '密码长度必须为 12 到 128 个字符', 400, {
        field: 'password',
      });
    }
    const passwordHash = await this.hashPassword(password);
    try {
      const result = await this.database.query<UserRow>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name`,
        [email, displayName, passwordHash],
      );
      return this.toPublicUser(result.rows[0]);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ApiError('EMAIL_IN_USE', '该邮箱已注册', 409);
      }
      throw error;
    }
  }

  async login(
    emailInput: string,
    password: string,
  ): Promise<{
    accessToken: string;
    expiresAt: string;
    user: PublicUser;
  }> {
    const email = this.normalizeEmail(emailInput);
    const result = await this.database.query<UserRow>(
      'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
      [email],
    );
    const user = result.rows[0];
    if (!user?.password_hash) {
      await deriveKey(password, Buffer.alloc(16), 64, SCRYPT_OPTIONS);
      throw new ApiError('UNAUTHENTICATED', '邮箱或密码不正确', 401);
    }
    if (!(await this.verifyPassword(password, user.password_hash))) {
      throw new ApiError('UNAUTHENTICATED', '邮箱或密码不正确', 401);
    }
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString();
    return {
      accessToken: this.signToken({ sub: user.id, iat: now, exp: now + TOKEN_TTL_SECONDS }),
      expiresAt,
      user: this.toPublicUser(user),
    };
  }

  async verifyAccessToken(token: string): Promise<string | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expected = this.sign(`${header}.${payload}`);
    const actualBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null;
    }
    try {
      const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
        alg?: string;
        typ?: string;
      };
      const parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        sub?: unknown;
        exp?: unknown;
        iat?: unknown;
      };
      if (
        parsedHeader.alg !== 'HS256' ||
        parsedHeader.typ !== 'JWT' ||
        typeof parsedPayload.sub !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsedPayload.sub,
        ) ||
        typeof parsedPayload.exp !== 'number' ||
        parsedPayload.exp <= Math.floor(Date.now() / 1000) ||
        typeof parsedPayload.iat !== 'number'
      )
        return null;
      return parsedPayload.sub;
    } catch {
      return null;
    }
  }

  private normalizeEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) {
      throw new ApiError('VALIDATION_ERROR', '邮箱格式不正确', 400, { field: 'email' });
    }
    return normalized;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await deriveKey(password, salt, 64, SCRYPT_OPTIONS);
    return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  private async verifyPassword(password: string, encoded: string): Promise<boolean> {
    const [algorithm, nText, rText, pText, saltText, hashText] = encoded.split('$');
    if (algorithm !== 'scrypt' || !nText || !rText || !pText || !saltText || !hashText)
      return false;
    const n = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    if (n !== SCRYPT_OPTIONS.N || r !== SCRYPT_OPTIONS.r || p !== SCRYPT_OPTIONS.p) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await deriveKey(password, salt, expected.length, SCRYPT_OPTIONS);
    return timingSafeEqual(actual, expected);
  }

  private signToken(payload: { sub: string; iat: number; exp: number }): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `${header}.${body}`;
    return `${unsigned}.${this.sign(unsigned)}`;
  }

  private sign(value: string): string {
    return createHmac('sha256', this.config.values.authTokenSecret)
      .update(value)
      .digest('base64url');
  }

  private toPublicUser(row: UserRow): PublicUser {
    return { id: row.id, email: row.email, displayName: row.display_name };
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
  }
}
