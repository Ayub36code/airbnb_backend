import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { UserStatus, PropertyStatus } from '@prisma/client';
import * as dayjs from 'dayjs';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  // ── Platform Dashboard
  async getDashboardStats() {
    const cacheKey = 'admin:dashboard-stats';
    const cached = await this.redisService.get(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const startOfMonth = dayjs().startOf('month').toDate();
    const startOfLastMonth = dayjs().subtract(1, 'month').startOf('month').toDate();
    const endOfLastMonth = dayjs().subtract(1, 'month').endOf('month').toDate();

    const [
      totalUsers, newUsersThisMonth, totalProperties, activeProperties,
      totalBookings, bookingsThisMonth, revenueThisMonth, revenueLastMonth,
      pendingApprovals, openDisputes, fraudAlerts,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
      this.prisma.property.count({ where: { deletedAt: null } }),
      this.prisma.property.count({ where: { status: PropertyStatus.ACTIVE } }),
      this.prisma.booking.count(),
      this.prisma.booking.count({ where: { createdAt: { gte: startOfMonth } } }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { amount: true },
      }),
      this.prisma.property.count({ where: { status: PropertyStatus.PENDING_REVIEW } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      this.prisma.fraudAlert.count({ where: { resolved: false } }),
      this.logger.log("")
    ]);

    const thisMonthRevenue = revenueThisMonth._sum.amount || 0;
    const lastMonthRevenue = revenueLastMonth._sum.amount || 0;
    const revenueGrowth = lastMonthRevenue
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : 0;

    const stats = {
      users: { total: totalUsers, newThisMonth: newUsersThisMonth },
      properties: { total: totalProperties, active: activeProperties, pendingApprovals },
      bookings: { total: totalBookings, thisMonth: bookingsThisMonth },
      revenue: {
        thisMonth: thisMonthRevenue,
        lastMonth: lastMonthRevenue,
        growth: revenueGrowth.toFixed(2),
      },
      alerts: { openDisputes, fraudAlerts },
      generatedAt: now,
    };

    await this.redisService.set(cacheKey, stats, 300); // 5 min
    return stats;
  }

  // ── Revenue Analytics ─────────────────────────────
  async getRevenueAnalytics(period: 'week' | 'month' | 'year' = 'month') {
    const startDate = period === 'week'
      ? dayjs().subtract(7, 'day').toDate()
      : period === 'month'
      ? dayjs().subtract(30, 'day').toDate()
      : dayjs().subtract(365, 'day').toDate();

    const groupFormat = period === 'week' ? 'YYYY-MM-DD' : period === 'month' ? 'YYYY-MM-DD' : 'YYYY-MM';

    const revenue = await this.prisma.$queryRaw`
      SELECT
        TO_CHAR(created_at, ${period === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD'}) as period,
        SUM(amount) as total_revenue,
        COUNT(*) as transaction_count,
        AVG(amount) as avg_transaction
      FROM payments
      WHERE status = 'COMPLETED'
        AND created_at >= ${startDate}
      GROUP BY TO_CHAR(created_at, ${period === 'year' ? 'YYYY-MM' : 'YYYY-MM-DD'})
      ORDER BY period ASC
    `;

    const bookingsByStatus = await this.prisma.booking.groupBy({
      by: ['status'],
      _count: { id: true },
      where: { createdAt: { gte: startDate } },
    });

    const topProperties = await this.prisma.property.findMany({
      where: { status: PropertyStatus.ACTIVE },
      orderBy: { totalBookings: 'desc' },
      take: 10,
      select: {
        id: true, title: true, city: true, country: true,
        totalBookings: true, avgRating: true, pricePerNight: true,
      },
    });

    return { revenue, bookingsByStatus, topProperties };
  }

  // ── User Management ───────────────────────────────
  async getAllUsers(filters: any = {}, page = 1, limit = 20) {
    const { role, status, search } = filters;
    return this.prisma.paginate(
      this.prisma.user,
      {
        where: {
          deletedAt: null,
          ...(role && { role }),
          ...(status && { status }),
          ...(search && {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
        select: {
          id: true, email: true, firstName: true, lastName: true, role: true,
          status: true, emailVerified: true, createdAt: true, lastLoginAt: true,
          _count: { select: { bookingsAsGuest: true, properties: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page, limit,
    );
  }

  async suspendUser(userId: string, adminId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') throw new ForbiddenException('Cannot suspend admin users');

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'USER_SUSPENDED',
        resource: 'users',
        resourceId: userId,
        newValues: { reason },
      },
    });

    // Invalidate sessions
    await this.prisma.userSession.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    return { message: 'User suspended' };
  }

  async activateUser(userId: string, adminId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
    });
    await this.prisma.auditLog.create({
      data: { userId: adminId, action: 'USER_ACTIVATED', resource: 'users', resourceId: userId },
    });
    return { message: 'User activated' };
  }

  async verifyUserIdentity(userId: string, adminId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { idVerified: true },
    });
    await this.prisma.userProfile.update({
      where: { userId },
      data: { verificationScore: 100 },
    });
    return { message: 'User identity verified' };
  }

  // ── Audit Logs ────────────────────────────────────
  async getAuditLogs(filters: any = {}, page = 1, limit = 50) {
    return this.prisma.paginate(
      this.prisma.auditLog,
      {
        where: {
          ...(filters.userId && { userId: filters.userId }),
          ...(filters.action && { action: filters.action }),
          ...(filters.resource && { resource: filters.resource }),
          ...(filters.from && filters.to && {
            createdAt: { gte: new Date(filters.from), lte: new Date(filters.to) },
          }),
        },
        include: {
          user: { select: { email: true, firstName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page, limit,
    );
  }

  // ── System Config ─────────────────────────────────
  async getSystemConfig() {
    const configs = await this.prisma.systemConfig.findMany();
    return configs.reduce((acc, c) => ({ ...acc, [c.key]: c.value }), {});
  }

  async setSystemConfig(key: string, value: any, adminId: string) {
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy: adminId },
      create: { key, value, updatedBy: adminId },
    });
  }

  // ── Platform Health ───────────────────────────────
  async getPlatformHealth() {
    const [dbOk, redisOk] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redisService.ping(),
    ]);

    return {
      database: dbOk ? 'healthy' : 'unhealthy',
      redis: redisOk ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
    };
  }
}
