import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { JsonBodyPipe, rejectUnknownFields, requiredString } from '../common/json-body.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body(new JsonBodyPipe()) body: Record<string, unknown>) {
    rejectUnknownFields(body, ['email', 'password', 'displayName']);
    const email = requiredString(body.email, 'email', 3, 320);
    const password = requiredString(body.password, 'password', 12, 128);
    const displayName = requiredString(body.displayName, 'displayName', 1, 80);
    if (!email.includes('@'))
      throw new ApiError('VALIDATION_ERROR', '邮箱格式不正确', 400, { field: 'email' });
    return { user: await this.auth.register(email, password, displayName) };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body(new JsonBodyPipe()) body: Record<string, unknown>) {
    rejectUnknownFields(body, ['email', 'password']);
    const email = requiredString(body.email, 'email', 3, 320);
    const password = requiredString(body.password, 'password', 1, 128);
    if (!email.includes('@'))
      throw new ApiError('VALIDATION_ERROR', '邮箱格式不正确', 400, { field: 'email' });
    return this.auth.login(email, password);
  }
}
