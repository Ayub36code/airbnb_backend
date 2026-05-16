// notifications.module.ts
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailService } from './channels/email.service';
import { SmsService } from './channels/sms.service';

@Module({
  providers: [NotificationsService, EmailService, SmsService],
  controllers: [NotificationsController],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
