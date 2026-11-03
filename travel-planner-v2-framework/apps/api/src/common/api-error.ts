import { HttpException } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }
}
