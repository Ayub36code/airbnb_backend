import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { INestApplication } from '@nestjs/common';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'colorless',
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected successfully');

    // Log slow queries in development
    if (process.env.NODE_ENV === 'development') {
      (this as any).$on('query', (e: any) => {
        if (e.duration > 1000) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }

    (this as any).$on('error', (e: any) => {
      this.logger.error('Prisma error:', e);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  // Helper: clean nested objects for Prisma updates
  clean(obj: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined),
    );
  }

  // Helper: paginate results
  async paginate<T>(
    model: any,
    args: any,
    page: number,
    limit: number,
  ): Promise<{ data: T[]; total: number; page: number; limit: number; pages: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      model.findMany({ ...args, skip, take: limit }),
      model.count({ where: args.where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
