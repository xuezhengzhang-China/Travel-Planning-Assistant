import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { uuid } from './validation';

export const B_AUTHENTICATOR = Symbol('B_AUTHENTICATOR');
export interface BAuthenticator {
  authenticate(authorization: string | undefined): Promise<{ userId: string } | null>;
}
export interface BRequest {
  headers: { authorization?: string };
  bUserId: string;
}

@Injectable()
export class BIdentityGuard implements CanActivate {
  constructor(@Inject(B_AUTHENTICATOR) private readonly authenticator: BAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<BRequest>();
    const identity = await this.authenticator.authenticate(request.headers.authorization);
    if (!identity) {
      throw new HttpException({ code: 'UNAUTHENTICATED', message: '请先登录' }, 401);
    }
    request.bUserId = uuid(identity.userId);
    return true;
  }
}
