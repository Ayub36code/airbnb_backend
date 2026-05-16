import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();
    const requestId = uuidv4();

    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-ID', requestId);

    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || '';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const { statusCode } = response;
          this.logger.log(`[${requestId}] ${method} ${url} ${statusCode} ${duration}ms - ${ip}`);
        },
        error: (err) => {
          const duration = Date.now() - start;
          this.logger.error(`[${requestId}] ${method} ${url} ERROR ${duration}ms - ${err.message}`);
        },
      }),
    );
  }
}
