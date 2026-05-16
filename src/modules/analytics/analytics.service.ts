import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as dayjs from 'dayjs';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  // ── Host Analytics
  async getHostAnalytics(hostId: string, period: 'week' | 'month' | 'year' = 'month') {
    const cacheKey = `analytics:host:${hostId}:${period}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) return cached;

    const startDate = period === 'week'
      ? dayjs().subtract(7, 'day').toDate()
      : period === 'month'
      ? dayjs().subtract(30, 'day').toDate()
      : dayjs().subtract(365, 'day').toDate();

    const [
      totalBookings, completedBookings, cancelledBookings,
      totalRevenue, avgRating, topProperty,
    ] = await Promise.all([
      this.prisma.booking.count({ where: { hostId, createdAt: { gte: startDate } } }),
      this.prisma.booking.count({ where: { hostId, status: 'CHECKED_OUT', createdAt: { gte: startDate } } }),
      this.prisma.booking.count({ where: { hostId, status: 'CANCELLED', createdAt: { gte: startDate } } }),
      this.prisma.booking.aggregate({
        where: { hostId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] }, createdAt: { gte: startDate } },
        _sum: { hostPayout: true },
      }),
      this.prisma.review.aggregate({
        where: {
          booking: { hostId },
          type: 'GUEST_TO_PROPERTY',
          createdAt: { gte: startDate },
        },
        _avg: { overallRating: true },
      }),
      this.prisma.property.findFirst({
        where: { hostId, status: 'ACTIVE' },
        orderBy: { totalBookings: 'desc' },
        select: { id: true, title: true, totalBookings: true, avgRating: true },
      }),
    ]);

    // Daily/Monthly revenue trend
    const revenueTrend = await this.prisma.$queryRaw`
      SELECT
        TO_CHAR(b.created_at, ${period === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD'}) as period,
        SUM(b.host_payout) as revenue,
        COUNT(*) as bookings
      FROM bookings b
      WHERE b.host_id = ${hostId}
        AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT')
        AND b.created_at >= ${startDate}
      GROUP BY TO_CHAR(b.created_at, ${period === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD'})
      ORDER BY period ASC
    `;

    // Occupancy rate
    const properties = await this.prisma.property.count({ where: { hostId, status: 'ACTIVE' } });
    const totalNights = await this.prisma.booking.aggregate({
      where: { hostId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] }, createdAt: { gte: startDate } },
      _sum: { nights: true },
    });
    const periodDays = period === 'week' ? 7 : period === 'month' ? 30 : 365;
    const occupancyRate = properties > 0
      ? ((totalNights._sum.nights || 0) / (properties * periodDays)) * 100
      : 0;

    const result = {
      summary: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        cancellationRate: totalBookings > 0 ? ((cancelledBookings / totalBookings) * 100).toFixed(1) : '0',
        totalRevenue: totalRevenue._sum.hostPayout || 0,
        avgRating: avgRating._avg.overallRating?.toFixed(2),
        occupancyRate: occupancyRate.toFixed(1),
        topProperty,
      },
      revenueTrend,
      period,
    };

    await this.redisService.set(cacheKey, result, 1800);
    return result;
  }

  // ── Property Analytics ─────────────────────────────
  async getPropertyAnalytics(propertyId: string, hostId: string, period = 'month') {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, hostId },
    });
    if (!property) throw new Error('Property not found or not authorized');

    const startDate = period === 'week'
      ? dayjs().subtract(7, 'day').toDate()
      : period === 'month'
      ? dayjs().subtract(30, 'day').toDate()
      : dayjs().subtract(365, 'day').toDate();

    const [bookingStats, reviewStats, viewStats] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { propertyId, createdAt: { gte: startDate } },
        _count: { id: true },
        _sum: { nights: true, totalAmount: true },
        _avg: { totalAmount: true },
      }),
      this.prisma.review.aggregate({
        where: { propertyId, createdAt: { gte: startDate } },
        _avg: {
          overallRating: true, cleanlinessRating: true, locationRating: true,
          valueRating: true, communicationRating: true,
        },
        _count: { id: true },
      }),
      this.prisma.propertyAnalytics.findMany({
        where: { propertyId, date: { gte: startDate } },
        orderBy: { date: 'asc' },
      }),
    ]);

    // Booking conversion (views -> bookings)
    const totalViews = viewStats.reduce((s, d) => s + d.views, 0);
    const conversionRate = totalViews > 0
      ? ((bookingStats._count.id / totalViews) * 100).toFixed(2)
      : '0';

    return {
      propertyId,
      period,
      bookings: {
        count: bookingStats._count.id,
        totalNights: bookingStats._sum.nights,
        totalRevenue: bookingStats._sum.totalAmount,
        avgBookingValue: bookingStats._avg.totalAmount?.toFixed(2),
      },
      reviews: {
        count: reviewStats._count.id,
        avgOverall: reviewStats._avg.overallRating?.toFixed(2),
        avgCleanliness: reviewStats._avg.cleanlinessRating?.toFixed(2),
        avgLocation: reviewStats._avg.locationRating?.toFixed(2),
        avgValue: reviewStats._avg.valueRating?.toFixed(2),
        avgCommunication: reviewStats._avg.communicationRating?.toFixed(2),
      },
      views: { total: totalViews, trend: viewStats },
      conversionRate,
    };
  }

  // ── Guest Analytics ────────────────────────────────
  async getGuestAnalytics(guestId: string) {
    const [bookingStats, reviewCount, favoritesCount] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { guestId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] } },
        _count: { id: true },
        _sum: { totalAmount: true, nights: true },
        _avg: { totalAmount: true },
      }),
      this.prisma.review.count({ where: { reviewerId: guestId } }),
      this.prisma.favorite.count({ where: { userId: guestId } }),
    ]);

    const topDestinations = await this.prisma.booking.groupBy({
      by: ['propertyId'],
      where: { guestId, status: 'CHECKED_OUT' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    return {
      totalTrips: bookingStats._count.id,
      totalNights: bookingStats._sum.nights || 0,
      totalSpent: bookingStats._sum.totalAmount || 0,
      avgTripCost: bookingStats._avg.totalAmount?.toFixed(2),
      reviewsWritten: reviewCount,
      favoritesCount,
      topDestinations,
    };
  }

  // ── Record Property View ───────────────────────────
  async recordPropertyView(propertyId: string, isUnique: boolean) {
    const today = dayjs().startOf('day').toDate();
    await this.prisma.propertyAnalytics.upsert({
      where: { propertyId_date: { propertyId, date: today } },
      create: {
        propertyId,
        date: today,
        views: 1,
        uniqueViews: isUnique ? 1 : 0,
      },
      update: {
        views: { increment: 1 },
        uniqueViews: isUnique ? { increment: 1 } : undefined,
      },
    });
  }

  // ── Platform-wide Summary (admin) ─────────────────
  async getPlatformSummary(period = 'month') {
    const startDate = period === 'week'
      ? dayjs().subtract(7, 'day').toDate()
      : period === 'month'
      ? dayjs().subtract(30, 'day').toDate()
      : dayjs().subtract(365, 'day').toDate();

    const [userGrowth, bookingGrowth, revenueGrowth, topCities] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as new_users
        FROM users WHERE created_at >= ${startDate}
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') ORDER BY date
      `,
      this.prisma.$queryRaw`
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as bookings
        FROM bookings WHERE created_at >= ${startDate}
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') ORDER BY date
      `,
      this.prisma.$queryRaw`
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, SUM(amount) as revenue
        FROM payments WHERE status = 'COMPLETED' AND created_at >= ${startDate}
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') ORDER BY date
      `,
      this.prisma.property.groupBy({
        by: ['city', 'country'],
        where: { status: 'ACTIVE' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    return { userGrowth, bookingGrowth, revenueGrowth, topCities, period };
  }
}
