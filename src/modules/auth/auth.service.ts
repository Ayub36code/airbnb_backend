import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import * as speakeasy from 'speakeasy';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '@prisma/client';
import {UserSession} from '@prisma/client'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCK_DURATION_MINUTES = 30;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  // ── Registration
  async register(dto: RegisterDto, ipAddress: string) {
    // Check for existing user
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, ...(dto.phone ? [{ phone: dto.phone }] : [])] },
    });
    if (existing) throw new ConflictException('Email or phone already in use');

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
    const verificationToken = uuidv4();

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          phone: dto.phone,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role || UserRole.GUEST,
          profile: { create: {} },
          wallet: { create: { currency: dto.currency || 'USD' } },
        },
      });

      // Store email verification token
      await this.redisService.set(
        `email-verify:${verificationToken}`,
        { userId: newUser.id },
        86400, // 24 hours
      );

      return newUser;
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_REGISTERED',
        resource: 'users',
        resourceId: user.id,
        ipAddress,
      },
    });

    this.logger.log(`New user registered: ${user.email} [${user.role}]`);
    return { message: 'Registration successful. Please verify your email.', userId: user.id };
  }

  // ── Login ─────────────────────────────────────────
  async login(dto: LoginDto, ipAddress: string, userAgent: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), deletedAt: null },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    // Check account lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Account locked. Try again in ${minutesLeft} minutes`);
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      await this.handleFailedLogin(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'SUSPENDED') throw new ForbiddenException('Account suspended');
    if (user.status === 'INACTIVE') throw new ForbiddenException('Account inactive');

    // Reset failed attempts
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ipAddress },
    });

    // 2FA check
    if (user.twoFactorEnabled) {
      if (!dto.totpCode) {
        const tempToken = uuidv4();
        await this.redisService.set(`2fa-pending:${tempToken}`, { userId: user.id }, 300);
        return { requires2FA: true, tempToken };
      }
      const valid = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: dto.totpCode,
        window: 1,
      });
      if (!valid) throw new UnauthorizedException('Invalid 2FA code');
    }

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);

    // Store session
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshToken: await bcrypt.hash(tokens.refreshToken, 10),
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deviceInfo: { userAgent },
      },
    });

    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_LOGIN', resource: 'auth', ipAddress },
    });

    return { ...tokens, user: this.sanitizeUser(user) };
  }

  // ── Refresh Token ─────────────────────────────────
  async refreshToken(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const sessions = await this.prisma.userSession.findMany({
      where: { userId: payload.sub, isActive: true, expiresAt: { gt: new Date() } },
    });

    let validSession: UserSession | null = null;
    for (const session of sessions) {
      const matches = await bcrypt.compare(refreshToken, session.refreshToken);

      if (matches) { validSession = session; break; }
    }

    if (!validSession) throw new UnauthorizedException('Session expired or invalid');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('User not found');

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);

    // Rotate refresh token
    await this.prisma.userSession.update({
      where: { id: validSession.id },
      data: {
        refreshToken: await bcrypt.hash(tokens.refreshToken, 10),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return tokens;
  }

  // ── Logout ────────────────────────────────────────
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const sessions = await this.prisma.userSession.findMany({
        where: { userId, isActive: true },
      });
      for (const session of sessions) {
        const matches = await bcrypt.compare(refreshToken, session.refreshToken);
        if (matches) {
          await this.prisma.userSession.update({
            where: { id: session.id },
            data: { isActive: false },
          });
          break;
        }
      }
    } else {
      // Logout all sessions
      await this.prisma.userSession.updateMany({
        where: { userId },
        data: { isActive: false },
      });
    }
    await this.redisService.deleteSession(userId);
    return { message: 'Logged out successfully' };
  }

  // ── Email Verification ────────────────────────────
  async verifyEmail(token: string) {
    const data = await this.redisService.get<{ userId: string }>(`email-verify:${token}`);
    if (!data) throw new BadRequestException('Invalid or expired verification token');

    await this.prisma.user.update({
      where: { id: data.userId },
      data: { emailVerified: true, status: 'ACTIVE' },
    });
    await this.redisService.del(`email-verify:${token}`);
    return { message: 'Email verified successfully' };
  }

  // ── Password Reset ────────────────────────────────
  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) return { message: 'If email exists, reset link has been sent' };

    const resetToken = uuidv4();
    await this.redisService.set(`pwd-reset:${resetToken}`, { userId: user.id }, 3600);
    // Email would be sent via NotificationsService
    this.logger.log(`Password reset requested for: ${email}`);
    return { message: 'If email exists, reset link has been sent', token: resetToken };
  }

  async resetPassword(token: string, newPassword: string) {
    const data = await this.redisService.get<{ userId: string }>(`pwd-reset:${token}`);
    if (!data) throw new BadRequestException('Invalid or expired reset token');

    const passwordHash = await bcrypt.hash(newPassword, this.SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: data.userId },
      data: { passwordHash },
    });

    // Invalidate all sessions
    await this.prisma.userSession.updateMany({
      where: { userId: data.userId },
      data: { isActive: false },
    });
    await this.redisService.del(`pwd-reset:${token}`);
    return { message: 'Password reset successfully' };
  }

  // ── 2FA Management ────────────────────────────────
  async setup2FA(userId: string) {
    const secret = speakeasy.generateSecret({ name: 'RentalPlatform', length: 20 });
    await this.redisService.set(`2fa-setup:${userId}`, secret.base32, 600);
    return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
  }

  async enable2FA(userId: string, token: string) {
    const secret = await this.redisService.get<string>(`2fa-setup:${userId}`);
    if (!secret) throw new BadRequestException('2FA setup expired');

    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
    if (!valid) throw new BadRequestException('Invalid 2FA token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorSecret: secret },
    });
    await this.redisService.del(`2fa-setup:${userId}`);
    return { message: '2FA enabled successfully' };
  }

  // ── Private Helpers ───────────────────────────────
  private async generateTokenPair(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiresIn', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn', '7d'),
      }),
    ]);

    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  private async handleFailedLogin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { failedLoginCount: true },
    });
    const count = (user?.failedLoginCount || 0) + 1;
    const lockData: any = { failedLoginCount: count };

    if (count >= this.MAX_LOGIN_ATTEMPTS) {
      lockData.lockedUntil = new Date(Date.now() + this.LOCK_DURATION_MINUTES * 60 * 1000);
      this.logger.warn(`Account locked after ${count} failed attempts: ${userId}`);
    }
    await this.prisma.user.update({ where: { id: userId }, data: lockData });
  }

  private sanitizeUser(user: any) {
    const { passwordHash, twoFactorSecret, ...safe } = user;
    return safe;
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }
}
