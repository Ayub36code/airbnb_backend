import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { EmailQueueProcessor } from './processors/email.processor';
import { NotificationQueueProcessor } from './processors/notification.processor';
import { PayoutQueueProcessor } from './processors/payout.processor';
import { BookingReminderProcessor } from './processors/booking-reminder.processor';
import { QueuesService } from './queues.service';

export const QUEUE_NAMES = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  PAYOUTS: 'payouts',
  BOOKING_REMINDERS: 'booking-reminders',
  SEARCH_INDEX: 'search-index',
};

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host', 'localhost'),
          port: configService.get<number>('redis.port', 6379),
          password: configService.get<string>('redis.password'),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
    }),
    NotificationsModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EMAIL },
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.PAYOUTS },
      { name: QUEUE_NAMES.BOOKING_REMINDERS },
      { name: QUEUE_NAMES.SEARCH_INDEX },
    ),
  ],
  providers: [
    QueuesService,
    EmailQueueProcessor,
    NotificationQueueProcessor,
    PayoutQueueProcessor,
    BookingReminderProcessor,
  ],
  exports: [BullModule, QueuesService],
})
export class QueuesModule {}
