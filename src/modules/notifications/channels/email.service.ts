import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

interface SendEmailParams {
  to: string;
  subject: string;
  template?: string;
  html?: string;
  context?: Record<string, any>;
  attachments?: any[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: configService.get<string>('SMTP_HOST'),
      port: configService.get<number>('SMTP_PORT', 587),
      secure: false,
      auth: {
        user: configService.get<string>('SMTP_USER'),
        pass: configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendEmail(params: SendEmailParams): Promise<void> {
    try {
      let html = params.html;

      if (params.template && params.context) {
        html = await this.renderTemplate(params.template, params.context);
      }

      await this.transporter.sendMail({
        from: `"${this.configService.get('EMAIL_FROM_NAME')}" <${this.configService.get('EMAIL_FROM')}>`,
        to: params.to,
        subject: params.subject,
        html,
        attachments: params.attachments,
      });

      this.logger.log(`Email sent to ${params.to}: ${params.subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${params.to}: ${error.message}`);
      throw error;
    }
  }

  async sendWelcomeEmail(email: string, firstName: string, verificationToken: string) {
    const verifyUrl = `${this.configService.get('APP_URL')}/api/v1/auth/verify-email/${verificationToken}`;
    await this.sendEmail({
      to: email,
      subject: 'Welcome to RentalPlatform – Verify Your Email',
      html: `
        <h2>Welcome, ${firstName}!</h2>
        <p>Thank you for joining RentalPlatform. Please verify your email to get started.</p>
        <a href="${verifyUrl}" style="background:#FF5A5F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
          Verify Email
        </a>
        <p>Link expires in 24 hours.</p>
      `,
    });
  }

  async sendPasswordResetEmail(email: string, firstName: string, resetToken: string) {
    const resetUrl = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${resetToken}`;
    await this.sendEmail({
      to: email,
      subject: 'Password Reset Request',
      html: `
        <h2>Hi ${firstName},</h2>
        <p>You requested a password reset. Click below to reset your password:</p>
        <a href="${resetUrl}" style="background:#FF5A5F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
          Reset Password
        </a>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `,
    });
  }

  async sendBookingConfirmationEmail(
    email: string,
    firstName: string,
    booking: any,
    property: any,
  ) {
    await this.sendEmail({
      to: email,
      subject: `Booking Confirmed – ${property.title}`,
      html: `
        <h2>Your booking is confirmed!</h2>
        <p>Hi ${firstName}, here are your booking details:</p>
        <table border="0" cellpadding="8">
          <tr><td><strong>Property:</strong></td><td>${property.title}</td></tr>
          <tr><td><strong>Booking #:</strong></td><td>${booking.bookingNumber}</td></tr>
          <tr><td><strong>Check-in:</strong></td><td>${new Date(booking.checkIn).toDateString()}</td></tr>
          <tr><td><strong>Check-out:</strong></td><td>${new Date(booking.checkOut).toDateString()}</td></tr>
          <tr><td><strong>Nights:</strong></td><td>${booking.nights}</td></tr>
          <tr><td><strong>Total:</strong></td><td>${booking.currency} ${booking.totalAmount}</td></tr>
        </table>
        <p>Your host will share check-in instructions soon.</p>
      `,
    });
  }

  async sendPayoutNotification(email: string, firstName: string, amount: number, currency: string) {
    await this.sendEmail({
      to: email,
      subject: 'Payout Processed',
      html: `
        <h2>Hi ${firstName},</h2>
        <p>Your payout of <strong>${currency} ${amount.toFixed(2)}</strong> has been processed.</p>
        <p>Funds should arrive in 1-3 business days depending on your bank.</p>
      `,
    });
  }

  private async renderTemplate(templateName: string, context: Record<string, any>): Promise<string> {
    const templatePath = path.join(__dirname, '../../../templates', `${templateName}.hbs`);
    if (fs.existsSync(templatePath)) {
      const templateSource = fs.readFileSync(templatePath, 'utf8');
      const compiled = handlebars.compile(templateSource);
      return compiled(context);
    }
    // Fallback to plain text
    return `<p>${JSON.stringify(context)}</p>`;
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
