// notification.processor.ts
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queues.module';
import { NotificationsService } from '../../modules/notifications/notifications.service';

@Processor('notifications')
export class NotificationQueueProcessor {
  private readonly logger = new Logger(NotificationQueueProcessor.name);

  constructor(private notificationsService: NotificationsService) {}

  @Process('send-notification')
  async handleNotification(job: Job) {
    const { userId, type, data } = job.data;
    await this.notificationsService.sendBookingNotification(userId, type, data?.bookingId, data);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Notification job ${job.id} failed: ${error.message}`);
  }
}
