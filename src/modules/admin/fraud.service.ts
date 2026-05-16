import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as geoip from 'geoip-lite';

interface FraudSignal {
  signal: string;
  score: number;
  details?: string;
}

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  // ── Analyze booking for fraud ─────────────────────
  async analyzeBooking(bookingData: {
    userId: string;
    propertyId: string;
    amount: number;
    ipAddress: string;
    userAgent?: string;
    checkIn: Date;
    checkOut: Date;
  }): Promise<{ riskScore: number; flags: FraudSignal[]; shouldBlock: boolean }> {
    const flags: FraudSignal[] = [];

    // ── Signal 1: New account booking high-value ──────
    const user = await this.prisma.user.findUnique({
      where: { id: bookingData.userId },
      select: { createdAt: true, emailVerified: true, idVerified: true, bookingsAsGuest: { select: { id: true } } },
    });
    if (!user) {throw new Error('User not found');}

    const accountAgeDays = (Date.now() - user.createdAt.getTime()) / 86400000;
    if (accountAgeDays < 3 && bookingData.amount > 500) {
      flags.push({ signal: 'NEW_ACCOUNT_HIGH_VALUE', score: 30, details: `Account ${accountAgeDays.toFixed(1)} days old` });
    }

    if (!user.emailVerified) {
      flags.push({ signal: 'UNVERIFIED_EMAIL', score: 25 });
    }

    // ── Signal 2: Multiple bookings in short time ──────
    const recentBookings = await this.prisma.booking.count({
      where: {
        guestId: bookingData.userId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (recentBookings >= 3) {
      flags.push({ signal: 'MULTIPLE_BOOKINGS_24H', score: 20, details: `${recentBookings} bookings in 24h` });
    }

    // ── Signal 3: IP geolocation mismatch ─────────────
    if (bookingData.ipAddress) {
      const geo = geoip.lookup(bookingData.ipAddress);
      if (geo) {
        const rateKey = `ip-bookings:${bookingData.ipAddress}`;
        const ipCount = await this.redisService.increment(rateKey);
        await this.redisService.expire(rateKey, 3600);
        if (ipCount > 10) {
          flags.push({ signal: 'HIGH_IP_BOOKING_RATE', score: 35, details: `${ipCount} bookings from same IP in 1h` });
        }
      }
    }

    // ── Signal 4: Payment amount anomaly ──────────────
    const avgBookingAmount = await this.prisma.payment.aggregate({
      where: { userId: bookingData.userId, status: 'COMPLETED' },
      _avg: { amount: true },
    });
    if (avgBookingAmount._avg.amount && bookingData.amount > avgBookingAmount._avg.amount * 5) {
      flags.push({ signal: 'UNUSUAL_AMOUNT', score: 25, details: `${bookingData.amount} vs avg ${avgBookingAmount._avg.amount}` });
    }

    // ── Signal 5: Same-day far-future booking ─────────
    const daysUntilCheckIn = (bookingData.checkIn.getTime() - Date.now()) / 86400000;
    if (daysUntilCheckIn > 365) {
      flags.push({ signal: 'FAR_FUTURE_BOOKING', score: 15 });
    }

    const riskScore = Math.min(flags.reduce((sum, f) => sum + f.score, 0), 100);
    const shouldBlock = riskScore >= 80;

    if (riskScore >= 50) {
      await this.prisma.fraudAlert.create({
        data: {
          userId: bookingData.userId,
          resourceType: 'booking',
          resourceId: bookingData.propertyId,
          riskScore,
          flags: flags as any,
        },
      });
      this.logger.warn(`Fraud risk score ${riskScore} for user ${bookingData.userId}`);
    }

    return { riskScore, flags, shouldBlock };
  }

  // ── Analyze Payment ────────────────────────────────
  async analyzePayment(paymentData: {
    userId: string;
    amount: number;
    method: string;
    ipAddress: string;
  }): Promise<{ riskScore: number; flags: FraudSignal[] }> {
    const flags: FraudSignal[] = [];

    // Failed payment history
    const recentFailures = await this.prisma.payment.count({
      where: {
        userId: paymentData.userId,
        status: 'FAILED',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recentFailures >= 3) {
      flags.push({ signal: 'MULTIPLE_PAYMENT_FAILURES', score: 40, details: `${recentFailures} failures in 1h` });
    }

    const riskScore = Math.min(flags.reduce((sum, f) => sum + f.score, 0), 100);
    return { riskScore, flags };
  }

  async getFraudAlerts(page = 1, limit = 20) {
    return this.prisma.paginate(
      this.prisma.fraudAlert,
      {
        where: { resolved: false },
        orderBy: [{ riskScore: 'desc' }, { createdAt: 'desc' }],
      },
      page, limit,
    );
  }

  async resolveAlert(alertId: string, adminId: string, notes: string) {
    return this.prisma.fraudAlert.update({
      where: { id: alertId },
      data: { resolved: true, resolvedAt: new Date(), resolvedBy: adminId, notes },
    });
  }
}
