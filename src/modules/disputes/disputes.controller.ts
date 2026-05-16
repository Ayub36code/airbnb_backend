import {
  Controller, Get, Post, Patch, Body, Param,
  Query, ParseUUIDPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DisputeStatus, UserRole } from '@prisma/client';

@ApiTags('Disputes')
@ApiBearerAuth('JWT')
@Controller('disputes')
@UseGuards(RolesGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @ApiOperation({ summary: 'Open a dispute for a booking' })
  openDispute(@CurrentUser() user: any, @Body() body: any) {
    return this.disputesService.openDispute(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'Get my disputes' })
  getUserDisputes(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.disputesService.getUserDisputes(user.id, page, limit);
  }

  @Get('admin/all')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] List all disputes' })
  getAllDisputes(
    @Query('status') status?: DisputeStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.disputesService.getAllDisputes(status, page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dispute details' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.disputesService.findOne(id, user.id, user.role);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Add message to dispute' })
  addMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() body: { content: string },
  ) {
    return this.disputesService.addMessage(id, user.id, body.content);
  }

  @Patch(':id/resolve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Resolve a dispute' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() body: { decision: 'HOST' | 'GUEST'; resolution: string; refundAmount?: number },
  ) {
    return this.disputesService.resolve(id, user.id, body.decision, body.resolution, body.refundAmount);
  }

  @Patch(':id/escalate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Escalate a dispute' })
  escalate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body('notes') notes: string,
  ) {
    return this.disputesService.escalate(id, user.id, notes);
  }
}
