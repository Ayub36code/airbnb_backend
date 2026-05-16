import { Controller, Get, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { RolesGuard } from '@common/guards/roles.guard';
import { UserRole } from '@prisma/client';

@ApiTags('Analytics')
@ApiBearerAuth('JWT')
@Controller('analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('host')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Host earnings and booking analytics' })
  getHostAnalytics(
    @CurrentUser() user: any,
    @Query('period') period: 'week' | 'month' | 'year' = 'month',
  ) {
    return this.analyticsService.getHostAnalytics(user.id, period);
  }

  @Get('host/properties/:propertyId')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Analytics for a specific property' })
  getPropertyAnalytics(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: any,
    @Query('period') period = 'month',
  ) {
    return this.analyticsService.getPropertyAnalytics(propertyId, user.id, period);
  }

  @Get('guest')
  @ApiOperation({ summary: 'Guest travel analytics' })
  getGuestAnalytics(@CurrentUser() user: any) {
    return this.analyticsService.getGuestAnalytics(user.id);
  }

  @Get('platform')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Platform-wide analytics summary' })
  getPlatformSummary(@Query('period') period = 'month') {
    return this.analyticsService.getPlatformSummary(period);
  }
}
