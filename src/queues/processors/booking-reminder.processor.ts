import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queues.module';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PrismaService } from '@modules/prisma/prisma.service';

@Processor('booking-reminders')
export class BookingReminderProcessor {
  private readonly logger = new Logger(BookingReminderProcessor.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  @Process('booking-reminder')
  async handleReminder(job: Job) {
    const { bookingId, userId } = job.data;

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { property: { select: { title: true } } },
    });

    if (!booking || !['CONFIRMED'].includes(booking.status)) {
      this.logger.log(`Skipping reminder for booking ${bookingId} (status: ${booking?.status})`);
      return;
    }

    await this.notificationsService.sendBookingNotification(
      booking.guestId,
      'BOOKING_REMINDER',
      bookingId,
      {
        propertyTitle: booking.property.title,
        checkIn: booking.checkIn,
      },
    );

    // Also notify host
    await this.notificationsService.sendBookingNotification(
      booking.hostId,
      'BOOKING_REMINDER',
      bookingId,
      { checkIn: booking.checkIn },
    );

    this.logger.log(`Booking reminder sent for booking ${bookingId}`);
  }
}
