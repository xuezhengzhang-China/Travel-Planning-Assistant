import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { JsonBodyPipe, rejectUnknownFields, requiredString } from '../common/json-body.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsersService } from './users.service';

@Controller('users/me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getById(user.userId);
  }

  @Patch()
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JsonBodyPipe()) body: Record<string, unknown>,
  ) {
    rejectUnknownFields(body, ['displayName']);
    const displayName = requiredString(body.displayName, 'displayName', 1, 80);
    if (!displayName.trim()) {
      throw new ApiError('VALIDATION_ERROR', 'displayName 不能为空', 400, { field: 'displayName' });
    }
    return this.users.updateDisplayName(user.userId, displayName);
  }
}
