import { Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';

export function invalid(message: string, code = 'VALIDATION_ERROR'): never {
  throw new HttpException({ code, message }, 400);
}
export function unavailable(message = '外部服务暂不可用，请稍后重试'): never {
  throw new HttpException({ code: 'DEPENDENCY_UNAVAILABLE', message }, 503);
}
export function notFound(): never {
  throw new HttpException({ code: 'NOT_FOUND', message: '资源不存在' }, 404);
}

// Scoped to B controllers so C can adopt/replace the public error policy independently.
@Catch()
export class BExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500;
    let body: object = { code: 'INTERNAL_ERROR', message: '服务暂不可用' };
    if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();
      if (typeof response === 'object' && response && 'code' in response) body = response;
      else
        body = {
          code: status === 400 ? 'VALIDATION_ERROR' : 'REQUEST_FAILED',
          message: '请求失败',
        };
    }
    host.switchToHttp().getResponse().status(status).json(body);
  }
}
