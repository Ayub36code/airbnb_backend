import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    // Check token blacklist (logout)
    const isBlacklisted = await this.redisService.exists(`blacklist:${payload.sub}`);
    if (isBlacklisted) throw new UnauthorizedException('Token revoked');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true, email: true, role: true, status: true,
        firstName: true, lastName: true, emailVerified: true,
      },
    });

    if (!user) throw new UnauthorizedException('User not found');
    if (user.status === 'SUSPENDED') throw new UnauthorizedException('Account suspended');

    return user;
  }
}
