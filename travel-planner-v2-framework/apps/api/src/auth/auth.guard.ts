import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
    }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new ApiError('UNAUTHENTICATED', '请先登录', 401);
    }
    const token = authorization.slice('Bearer '.length).trim();
    const userId = await this.auth.verifyAccessToken(token);
    if (!userId) throw new ApiError('UNAUTHENTICATED', '登录凭证无效或已过期', 401);
    request.user = { userId };
    return true;
  }
}
