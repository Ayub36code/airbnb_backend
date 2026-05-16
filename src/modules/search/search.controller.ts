import { Controller, Get, Query, ParseFloatPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { PropertyFilterDto } from '../properties/dto/property-filter.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('properties')
  @Public()
  @ApiOperation({ summary: 'Full-text + filtered property search via Elasticsearch' })
  search(@Query() filters: PropertyFilterDto) {
    return this.searchService.searchProperties(filters);
  }

  @Get('nearby')
  @Public()
  @ApiOperation({ summary: 'Find properties near a geo-location' })
  nearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
    @Query('radius') radius = 25,
    @Query() filters: Partial<PropertyFilterDto>,
  ) {
    return this.searchService.searchNearby(lat, lon, Number(radius), filters);
  }

  @Get('autocomplete')
  @Public()
  @ApiOperation({ summary: 'Location/property autocomplete suggestions' })
  autocomplete(@Query('q') query: string) {
    return this.searchService.autocomplete(query || '');
  }

  @Get('recommendations')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Personalized property recommendations' })
  recommendations(@CurrentUser() user: any, @Query('limit') limit = 8) {
    return this.searchService.getRecommendations(user.id, Number(limit));
  }

  @Get('reindex')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: '[Admin] Re-index all properties in Elasticsearch' })
  reindex() {
    return this.searchService.reindexAll();
  }
}
