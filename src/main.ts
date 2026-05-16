import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { winstonConfig } from '@config/logger.config';
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';
import { TransformInterceptor } from '@common/interceptors/transform.interceptor';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { PrismaService } from '@modules/prisma/prisma.service';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(winstonConfig),
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // ── Security
  app.use(helmet({
    contentSecurityPolicy: nodeEnv === 'production',
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());

  // ── CORS
  app.enableCors({
    origin: configService.get<string>('FRONTEND_URL', 'http://localhost:3001'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  });

  // ── API Versioning
  app.enableVersioning({ type: VersioningType.URI });
  app.setGlobalPrefix(configService.get<string>('API_PREFIX', 'api/v1'));

  // ── Global Pipes, Filters, Interceptors ───────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  app.use('/stripe/webhook',
    express.raw({type: 'application/json'}),
    )

  // ── Swagger Documentation
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('RentalPlatform API')
      .setDescription('Airbnb-style rental platform - Enterprise Backend API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
      .addTag('Auth', 'Authentication & Authorization')
      .addTag('Users', 'User Management')
      .addTag('Properties', 'Property Management')
      .addTag('Bookings', 'Booking System')
      .addTag('Payments', 'Payment Processing')
      .addTag('Reviews', 'Reviews & Ratings')
      .addTag('Messages', 'Messaging System')
      .addTag('Notifications', 'Notification System')
      .addTag('Search', 'Property Search & Filters')
      .addTag('Analytics', 'Analytics & Reporting')
      .addTag('Admin', 'Admin Dashboard')
      .addTag('Wallet', 'Wallet System')
      .addTag('Disputes', 'Dispute Management')
      .addTag('Files', 'File & Media Upload')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Graceful Shutdown
  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await app.close();
    process.exit(0);
  });

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 RentalPlatform API running on port ${port} [${nodeEnv}]`);
  console.log(`📚 Swagger docs: http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
