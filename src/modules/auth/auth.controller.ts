import {
  Controller, Post, Body, Req, Res, Get,
  HttpCode, HttpStatus, UseGuards, Param, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register new user' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket.remoteAddress ||
      req.ip;
    if (!ip) {throw new BadRequestException('Invalid IP address');}
    return this.authService.register(dto, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket.remoteAddress ||
      req.ip;
    const userAgent = req.headers['user-agent'];
    if (!ip) {throw new BadRequestException('Invalid IP address');}
    if (!userAgent) {throw new BadRequestException('Invalid User Agent');}
    return this.authService.login(dto, ip, userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Logout user' })
  async logout(@CurrentUser() user: any, @Body('refreshToken') refreshToken?: string) {
    return this.authService.logout(user.id, refreshToken);
  }

  @Public()
  @Get('verify-email/:token')
  @ApiOperation({ summary: 'Verify email address' })
  async verifyEmail(@Param('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Public()
  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 300000 } })
  @ApiOperation({ summary: 'Request password reset' })
  async forgotPassword(@Body('email') email: string) {
    return this.authService.requestPasswordReset(email);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('2fa/setup')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Setup 2FA - get secret and QR code' })
  async setup2FA(@CurrentUser() user: any) {
    return this.authService.setup2FA(user.id);
  }

  @Post('2fa/enable')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Enable 2FA with verification code' })
  async enable2FA(@CurrentUser() user: any, @Body('token') token: string) {
    return this.authService.enable2FA(user.id, token);
  }
}
