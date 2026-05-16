import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './channels/email.service';
import { SmsService } from './channels/sms.service';
import { NotificationType, NotificationChannel } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private smsService: SmsService,
  ) {}

  async sendBookingNotification(
    userId: string,
    type: string,
    bookingId: string,
    metadata?: Record<string, any>,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true, firstName: true, preferredLanguage: true },
    });
    if (!user) return;

    const templates = this.getNotificationTemplates(type, { ...metadata, userId });

    // Create in-app notification
    await this.prisma.notification.create({
      data: {
        userId,
        type: type as NotificationType,
        title: templates.title,
        body: templates.body,
        data: { bookingId, ...metadata },
        channel: NotificationChannel.IN_APP,
      },
    });

    // Send email
    if (user.email) {
      await this.emailService.sendEmail({
        to: user.email,
        subject: templates.emailSubject || templates.title,
        template: templates.emailTemplate || 'default',
        context: { firstName: user.firstName, ...templates, ...metadata },
      }).catch(e => this.logger.error('Email send error:', e));
    }

    // Send SMS for critical notifications
    const smsTypes = ['BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'PAYMENT_RECEIVED'];
    if (smsTypes.includes(type) && user.phone) {
      await this.smsService.sendSms(user.phone, templates.smsMessage || templates.body)
        .catch(e => this.logger.error('SMS send error:', e));
    }
  }

  async getUserNotifications(userId: string, page = 1, limit = 20) {
    return this.prisma.paginate(
      this.prisma.notification,
      { where: { userId }, orderBy: { createdAt: 'desc' } },
      page, limit,
    );
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  private getNotificationTemplates(type: string, data: any) {
    const templates: Record<string, any> = {
      BOOKING_REQUEST: {
        title: 'New Booking Request',
        body: 'You have a new booking request',
        emailTemplate: 'booking-request',
        smsMessage: 'New booking request received on RentalPlatform',
      },
      BOOKING_CONFIRMED: {
        title: 'Booking Confirmed!',
        body: 'Your booking has been confirmed',
        emailTemplate: 'booking-confirmed',
        smsMessage: 'Your booking is confirmed. Check-in code will be sent separately.',
      },
      BOOKING_CANCELLED: {
        title: 'Booking Cancelled',
        body: 'A booking has been cancelled',
        emailTemplate: 'booking-cancelled',
        smsMessage: 'Your booking has been cancelled. Refund will be processed within 3-5 days.',
      },
      PAYMENT_RECEIVED: {
        title: 'Payment Received',
        body: 'Payment has been received',
        emailTemplate: 'payment-received',
        smsMessage: 'Payment received for your booking on RentalPlatform',
      },
      PAYMENT_FAILED: {
        title: 'Payment Failed',
        body: 'Your payment could not be processed',
        emailTemplate: 'payment-failed',
      },
      REVIEW_RECEIVED: {
        title: 'New Review',
        body: 'You have received a new review',
        emailTemplate: 'review-received',
      },
      MESSAGE_RECEIVED: {
        title: 'New Message',
        body: 'You have a new message',
        emailTemplate: 'message-received',
      },
      BOOKING_REMINDER: {
        title: 'Upcoming Booking',
        body: 'Your check-in is tomorrow',
        emailTemplate: 'booking-reminder',
        smsMessage: 'Reminder: Your check-in at RentalPlatform is tomorrow',
      },
    };

    return templates[type] || { title: type, body: JSON.stringify(data) };
  }
}
