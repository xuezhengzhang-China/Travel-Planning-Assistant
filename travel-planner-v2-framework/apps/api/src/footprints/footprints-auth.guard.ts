import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

export interface AuthenticatedRequest {
  user?: { id: string };
}

@Injectable()
export class FootprintsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (
      !request.user ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.user.id,
      )
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'A valid signed-in user is required',
      });
    }
    return true;
  }
}
