import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES } from './queues.module';

@Injectable()
export class QueuesService {
  private readonly logger = new Logger(QueuesService.name);

  constructor(
    @InjectQueue('email') private emailQueue: Queue,
    @InjectQueue('notifications') private notifQueue: Queue,
    @InjectQueue('payouts') private payoutQueue: Queue,
    @InjectQueue('booking-reminders') private reminderQueue: Queue,
    @InjectQueue('search-index') private searchQueue: Queue,
  ) {}

  // ── Email Jobs
  async addEmailJob(data: {
    to: string; subject: string; template: string; context: any;
  }) {
    await this.emailQueue.add('send-email', data, { priority: 5 });
  }

  async addWelcomeEmailJob(userId: string, email: string, firstName: string, token: string) {
    await this.emailQueue.add('welcome-email', { userId, email, firstName, token });
  }

  // ── Notification Jobs
  async addNotificationJob(data: { userId: string; type: string; data: any }) {
    await this.notifQueue.add('send-notification', data, { priority: 3 });
  }

  async addBulkNotificationJob(userIds: string[], type: string, data: any) {
    const jobs = userIds.map((userId) => ({
      name: 'send-notification',
      data: { userId, type, data },
    }));
    await this.notifQueue.addBulk(jobs);
  }

  // ── Payout Jobs ───────────────────────────────────
  async addPayoutJob(data: {
    userId: string; amount: number; currency: string; bookingId: string;
  }) {
    await this.payoutQueue.add('process-payout', data, {
      delay: 24 * 60 * 60 * 1000, // 24h after checkout
      priority: 10,
    });
  }

  // ── Booking Reminders ─────────────────────────────
  async scheduleBookingReminder(bookingId: string, checkIn: Date, userId: string) {
    const reminderTime = new Date(checkIn);
    reminderTime.setDate(reminderTime.getDate() - 1); // 1 day before
    const delay = reminderTime.getTime() - Date.now();

    if (delay > 0) {
      await this.reminderQueue.add(
        'booking-reminder',
        { bookingId, userId },
        { delay, jobId: `reminder-${bookingId}` },
      );
    }
  }

  // ── Search Index Jobs ─────────────────────────────
  async addIndexPropertyJob(propertyId: string) {
    await this.searchQueue.add('index-property', { propertyId }, {
      priority: 8,
      attempts: 5,
    });
  }

  async addRemovePropertyJob(propertyId: string) {
    await this.searchQueue.add('remove-property', { propertyId });
  }

  // ── Queue Stats ───────────────────────────────────
  async getQueueStats() {
    const queues = [this.emailQueue, this.notifQueue, this.payoutQueue, this.reminderQueue];
    const stats = await Promise.all(
      queues.map(async (q) => ({
        name: q.name,
        waiting: await q.getWaitingCount(),
        active: await q.getActiveCount(),
        completed: await q.getCompletedCount(),
        failed: await q.getFailedCount(),
        delayed: await q.getDelayedCount(),
      })),
    );
    return stats;
  }
}
