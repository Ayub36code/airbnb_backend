import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as twilio from 'twilio';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private client: twilio.Twilio;
  private fromNumber: string;

  constructor(private configService: ConfigService) {
    const accountSid = configService.get<string>('TWILIO_ACCOUNT_SID', '').trim();
    const authToken = configService.get<string>('TWILIO_AUTH_TOKEN', '').trim();
    const fromNumber = configService.get<string>('TWILIO_PHONE_NUMBER', '').trim();

    if (!fromNumber) {
      throw new Error('TWILIO_PHONE_NUMBER is not configured');
    }
    this.fromNumber = fromNumber;

    if (!accountSid || !authToken) {
      this.logger.warn('Twilio is not configured (missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN). SMS will be skipped.');
      return;
    }

    if (!/^AC[a-zA-Z0-9]{32}$/.test(accountSid)) {
      this.logger.warn('Invalid TWILIO_ACCOUNT_SID format; expected a Twilio account SID starting with AC. SMS will be skipped.');
      return;
    }

    this.client = twilio(accountSid, authToken);
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (!this.client) {
      this.logger.warn('Twilio not configured, skipping SMS');
      return;
    }
    try {
      await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to,
      });
      this.logger.log(`SMS sent to ${to}`);
    } catch (error) {
      this.logger.error(`SMS failed to ${to}: ${error.message}`);
      throw error;
    }
  }

  async sendVerificationCode(phone: string, code: string): Promise<void> {
    await this.sendSms(phone, `Your RentalPlatform verification code: ${code}. Valid for 10 minutes.`);
  }

  async sendBookingReminder(phone: string, propertyTitle: string, checkIn: Date): Promise<void> {
    await this.sendSms(
      phone,
      `Reminder: Your stay at "${propertyTitle}" begins ${checkIn.toDateString()}. Safe travels! – RentalPlatform`,
    );
  }
}
