export interface AuthenticatedUser {
  userId: string;
}

export type { PublicUser } from '@travel/shared' with { 'resolution-mode': 'import' };

export interface AccessTokenPayload {
  sub: string;
  iat: number;
  exp: number;
}
