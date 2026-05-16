// email.processor.ts
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queues.module';
import { EmailService } from '@modules/notifications/channels/email.service';

console.log(QUEUE_NAMES)

@Processor('email')
export class EmailQueueProcessor {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(private emailService: EmailService) {}

  @Process('send-email')
  async handleSendEmail(job: Job) {
    const { to, subject, template, context } = job.data;
    await this.emailService.sendEmail({ to, subject, template, context });
    this.logger.log(`Email sent to ${to}: ${subject}`);
  }

  @Process('welcome-email')
  async handleWelcomeEmail(job: Job) {
    const { email, firstName, token } = job.data;
    await this.emailService.sendWelcomeEmail(email, firstName, token);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Email job ${job.id} failed: ${error.message}`);
  }
}
