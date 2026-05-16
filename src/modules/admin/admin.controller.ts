import {
  Controller, Get, Post, Patch, Body, Param,
  Query, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { FraudService } from './fraud.service';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { RolesGuard } from '@common/guards/roles.guard';
import { UserRole } from '@prisma/client';

@ApiTags('Admin')
@ApiBearerAuth('JWT')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly fraudService: FraudService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Platform dashboard statistics' })
  getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('analytics/revenue')
  @ApiOperation({ summary: 'Revenue analytics' })
  getRevenueAnalytics(@Query('period') period: 'week' | 'month' | 'year' = 'month') {
    return this.adminService.getRevenueAnalytics(period);
  }

  @Get('health')
  @ApiOperation({ summary: 'Platform health check' })
  getHealth() {
    return this.adminService.getPlatformHealth();
  }

  // ── User Management ───────────────────────────────
  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  getAllUsers(
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.adminService.getAllUsers({ role, status, search }, page, limit);
  }

  @Patch('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend a user account' })
  suspendUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: any,
    @Body('reason') reason: string,
  ) {
    return this.adminService.suspendUser(id, admin.id, reason);
  }

  @Patch('users/:id/activate')
  @ApiOperation({ summary: 'Activate a suspended user' })
  activateUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: any) {
    return this.adminService.activateUser(id, admin.id);
  }

  @Patch('users/:id/verify-identity')
  @ApiOperation({ summary: 'Mark user identity as verified' })
  verifyIdentity(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: any) {
    return this.adminService.verifyUserIdentity(id, admin.id);
  }

  // ── Audit Logs ────────────────────────────────────
  @Get('audit-logs')
  @ApiOperation({ summary: 'Get platform audit logs' })
  getAuditLogs(
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.adminService.getAuditLogs({ userId, action, resource, from, to }, page, limit);
  }

  // ── System Config ─────────────────────────────────
  @Get('config')
  @ApiOperation({ summary: 'Get system configuration' })
  getConfig() {
    return this.adminService.getSystemConfig();
  }

  @Post('config')
  @ApiOperation({ summary: 'Update system configuration' })
  setConfig(
    @Body() body: { key: string; value: any },
    @CurrentUser() admin: any,
  ) {
    return this.adminService.setSystemConfig(body.key, body.value, admin.id);
  }

  // ── Fraud Alerts ──────────────────────────────────
  @Get('fraud-alerts')
  @ApiOperation({ summary: 'Get fraud detection alerts' })
  getFraudAlerts(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.fraudService.getFraudAlerts(page, limit);
  }

  @Patch('fraud-alerts/:id/resolve')
  @ApiOperation({ summary: 'Resolve a fraud alert' })
  resolveFraudAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: any,
    @Body('notes') notes: string,
  ) {
    return this.fraudService.resolveAlert(id, admin.id, notes);
  }
}
