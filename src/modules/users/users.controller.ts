import {
  Controller, Get, Put, Patch, Delete, Body,
  Param, ParseUUIDPipe, UseGuards, Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { RolesGuard } from '@common/guards/roles.guard';

@ApiTags('Users')
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: any) {
    return this.usersService.getProfile(user.id);
  }

  @Get(':id/public')
  @Public()
  @ApiOperation({ summary: 'Get public user profile' })
  getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getPublicProfile(id);
  }

  @Put('me')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update user profile' })
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Patch('me/password')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Change password' })
  changePassword(
    @CurrentUser() user: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.usersService.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Patch('me/phone')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update and verify phone number' })
  updatePhone(
    @CurrentUser() user: any,
    @Body() body: { phone: string; verificationCode: string },
  ) {
    return this.usersService.updatePhone(user.id, body.phone, body.verificationCode);
  }

  @Post('me/become-host')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Upgrade account to host' })
  becomeHost(@CurrentUser() user: any) {
    return this.usersService.becomeHost(user.id);
  }

  @Get('me/sessions')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'List active sessions' })
  getSessions(@CurrentUser() user: any) {
    return this.usersService.getSessions(user.id);
  }

  @Delete('me/sessions/:sessionId')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Revoke a specific session' })
  revokeSession(
    @CurrentUser() user: any,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.usersService.revokeSession(user.id, sessionId);
  }

  @Delete('me')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Delete account' })
  deleteAccount(@CurrentUser() user: any, @Body('password') password: string) {
    return this.usersService.deleteAccount(user.id, password);
  }
}

// Missing import

