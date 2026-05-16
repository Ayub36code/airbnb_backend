import {
  Controller, Get, Post, Put, Patch, Delete, Body,
  Param, Query, UseGuards, UploadedFiles,
  UseInterceptors, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyFilterDto } from './dto/property-filter.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Properties')
@Controller('properties')
@UseGuards(RolesGuard)
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Create a new property listing' })
  create(@CurrentUser() user: any, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(user.id, dto);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Search and list properties' })
  findAll(@Query() filters: PropertyFilterDto, @CurrentUser() user: any) {
    return this.propertiesService.findAll(filters, user?.id);
  }

  @Get('favorites')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current user wishlist/favorites' })
  getFavorites(
    @CurrentUser() user: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.propertiesService.getUserFavorites(user.id, page, limit);
  }

  @Get('host/mine')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get host own properties' })
  getMyProperties(
    @CurrentUser() user: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.propertiesService.getHostProperties(user.id, page, limit);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get property details' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.propertiesService.findOne(id, user?.id);
  }

  @Put(':id')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update property' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.propertiesService.update(id, user.id, dto, user.role);
  }

  @Delete(':id')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Delete property' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.propertiesService.remove(id, user.id, user.role);
  }

  @Post(':id/amenities')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Set property amenities' })
  setAmenities(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body('amenityIds') amenityIds: string[],
  ) {
    return this.propertiesService.setAmenities(id, user.id, amenityIds);
  }

  @Get(':id/availability')
  @Public()
  @ApiOperation({ summary: 'Get property availability calendar' })
  getAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('year') year: number,
    @Query('month') month: number,
  ) {
    return this.propertiesService.getAvailability(id, year, month);
  }

  @Post(':id/block-dates')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Block dates for a property' })
  blockDates(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() body: { startDate: string; endDate: string; reason?: string },
  ) {
    return this.propertiesService.blockDates(
      id, user.id, new Date(body.startDate), new Date(body.endDate), body.reason,
    );
  }

  @Get(':id/price-calculator')
  @Public()
  @ApiOperation({ summary: 'Calculate total price for booking' })
  calculatePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('checkIn') checkIn: string,
    @Query('checkOut') checkOut: string,
    @Query('guests') guests: number,
  ) {
    return this.propertiesService.calculatePrice(
      id, new Date(checkIn), new Date(checkOut), guests,
    );
  }

  @Post(':id/favorite')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Toggle property favorite/wishlist' })
  toggleFavorite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.propertiesService.toggleFavorite(id, user.id);
  }

  // Admin endpoints
  @Patch(':id/approve')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: '[Admin] Approve property listing' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.propertiesService.approve(id, user.id);
  }

  @Patch(':id/suspend')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: '[Admin] Suspend property' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body('reason') reason: string,
  ) {
    return this.propertiesService.suspend(id, user.id, reason);
  }
}
