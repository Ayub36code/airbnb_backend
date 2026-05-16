import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as bcrypt from 'bcrypt';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true, displayName: true,
        avatarUrl: true, bio: true, phone: true, role: true, status: true,
        emailVerified: true, phoneVerified: true, idVerified: true,
        twoFactorEnabled: true, preferredLanguage: true, preferredCurrency: true,
        timezone: true, createdAt: true, lastLoginAt: true,
        profile: true,
        wallet: { select: { balance: true, pendingBalance: true, currency: true } },
        _count: {
          select: {
            properties: true,
            bookingsAsGuest: true,
            reviewsGiven: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true, firstName: true, displayName: true, avatarUrl: true, bio: true,
        createdAt: true,
        profile: {
          select: {
            superhost: true, responseRate: true, avgResponseTime: true,
            hostSince: true, totalTrips: true, totalHostedTrips: true,
          },
        },
        reviewsReceived: {
          where: { isPublic: true },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            reviewer: { select: { firstName: true, avatarUrl: true } },
          },
        },
        properties: {
          where: { status: 'ACTIVE', deletedAt: null },
          take: 6,
          include: { images: { where: { isPrimary: true }, take: 1 } },
        },
        _count: {
          select: { reviewsReceived: true, properties: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: dto.displayName,
        bio: dto.bio,
        preferredLanguage: dto.preferredLanguage,
        preferredCurrency: dto.preferredCurrency,
        timezone: dto.timezone,
        ...(dto.profile && {
          profile: {
            update: {
              address: dto.profile.address,
              city: dto.profile.city,
              country: dto.profile.country,
              postalCode: dto.profile.postalCode,
              emergencyContact: dto.profile.emergencyContact,
              socialLinks: dto.profile.socialLinks,
            },
          },
        }),
      },
      select: {
        id: true, firstName: true, lastName: true, displayName: true,
        bio: true, preferredLanguage: true, preferredCurrency: true,
        timezone: true, profile: true,
      },
    });

    await this.redisService.del(`user:profile:${userId}`);
    return updated;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {throw new Error('User not found');}
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });

    // Invalidate all sessions for security
    await this.prisma.userSession.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    return { message: 'Password changed. Please login again.' };
  }

  async updatePhone(userId: string, phone: string, verificationCode: string) {
    // Verify the code from Redis
    const storedCode = await this.redisService.get<string>(`phone-verify:${userId}`);
    if (!storedCode || storedCode !== verificationCode) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Check phone not already in use
    const existing = await this.prisma.user.findFirst({
      where: { phone, id: { not: userId } },
    });
    if (existing) throw new BadRequestException('Phone number already in use');

    await this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerified: true },
    });
    await this.redisService.del(`phone-verify:${userId}`);
    return { message: 'Phone updated and verified' };
  }

  async becomeHost(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'HOST' || user.role === 'ADMIN') {
      throw new BadRequestException('Already a host');
    }
    if (!user.emailVerified) {
      throw new BadRequestException('Please verify your email first');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { role: 'HOST' },
      }),
      this.prisma.userProfile.update({
        where: { userId },
        data: { hostSince: new Date() },
      }),
    ]);

    return { message: 'You are now a host! Start listing your properties.' };
  }

  async getSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, isActive: true, expiresAt: { gt: new Date() } },
      select: {
        id: true, ipAddress: true, userAgent: true, deviceInfo: true,
        createdAt: true, expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException('Session not found');

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
    return { message: 'Session revoked' };
  }

  async deleteAccount(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {throw new BadRequestException('User not found');}
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new BadRequestException('Incorrect password');

    // Check for active bookings
    const activeBookings = await this.prisma.booking.count({
      where: {
        OR: [{ guestId: userId }, { hostId: userId }],
        status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
      },
    });
    if (activeBookings > 0) {
      throw new BadRequestException('Cannot delete account with active bookings');
    }

    // Soft delete
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: `deleted-${userId}@deleted.com`,
        phone: null,
        status: 'INACTIVE',
      },
    });

    return { message: 'Account deleted' };
  }
}
