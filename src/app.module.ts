import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

// Feature Modules
import { AuthModule } from '@modules/auth/auth.module';
import { UsersModule } from '@modules/users/users.module';
import { PropertiesModule } from '@modules/properties/properties.module';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { SearchModule } from '@modules/search/search.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { AdminModule } from '@modules/admin/admin.module';
import { WalletModule } from '@modules/wallet/wallet.module';
import { DisputesModule } from '@modules/disputes/disputes.module';
import { FilesModule } from '@modules/files/files.module';

// Core Modules
import { PrismaModule } from '@modules/prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueuesModule } from './queues/queues.module';
import { WebsocketsModule } from './websockets/websockets.module';
import { HealthModule } from '@modules/health/health.module';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import jwtConfig from './config/jwt.config';
import awsConfig from './config/aws.config';
import stripeConfig from './config/stripe.config';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, jwtConfig, awsConfig, stripeConfig],
      envFilePath: ['.env', '.env.local'],
      cache: true,
    }),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
            limit: configService.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
      }),
    }),

    // Events & Scheduling
    EventEmitterModule.forRoot({ wildcard: true, maxListeners: 20 }),
    ScheduleModule.forRoot(),

    // Core Infrastructure
    PrismaModule,
    RedisModule,
    QueuesModule,
    WebsocketsModule,
    HealthModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    PropertiesModule,
    BookingsModule,
    PaymentsModule,
    ReviewsModule,
    MessagingModule,
    NotificationsModule,
    SearchModule,
    AnalyticsModule,
    AdminModule,
    WalletModule,
    DisputesModule,
    FilesModule,
  ],
  providers: [
    // Global JWT Guard - all routes protected by default
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global rate limiting
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
