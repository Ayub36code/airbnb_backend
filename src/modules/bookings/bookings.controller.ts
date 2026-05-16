import {
  Controller, Get, Post, Patch, Body, Param,
  Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '@prisma/client';

@ApiTags('Bookings')
@ApiBearerAuth('JWT')
@Controller('bookings')
@UseGuards(RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @Roles(UserRole.GUEST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a booking request' })
  create(@CurrentUser() user: any, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(user.id, dto);
  }

  @Get('my-trips')
  @ApiOperation({ summary: 'Get guest upcoming/past trips' })
  getMyTrips(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.bookingsService.getGuestBookings(user.id, status, page, limit);
  }

  @Get('host-reservations')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get host incoming reservations' })
  getHostReservations(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.bookingsService.getHostBookings(user.id, status, page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking details' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.bookingsService.findOne(id, user.id, user.role);
  }

  @Patch(':id/confirm')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Host confirms booking request' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.bookingsService.confirm(id, user.id);
  }

  @Patch(':id/reject')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Host rejects booking request' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body('reason') reason: string,
  ) {
    return this.bookingsService.reject(id, user.id, reason);
  }

  @Patch(':id/check-in')
  @ApiOperation({ summary: 'Record guest check-in' })
  checkIn(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.bookingsService.checkIn(id, user.id, user.role);
  }

  @Patch(':id/check-out')
  @ApiOperation({ summary: 'Record guest check-out' })
  checkOut(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.bookingsService.checkOut(id, user.id, user.role);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a booking' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body('reason') reason: string,
  ) {
    return this.bookingsService.cancel(id, user.id, user.role, reason);
  }

  @Get(':id/invoice')
  @ApiOperation({ summary: 'Get booking invoice' })
  getInvoice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.bookingsService.getInvoice(id, user.id);
  }
}
