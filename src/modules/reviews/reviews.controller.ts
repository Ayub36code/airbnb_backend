// reviews.controller.ts
import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Submit a review after checkout' })
  create(@CurrentUser() user: any, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user.id, dto);
  }

  @Get('properties/:propertyId')
  @Public()
  @ApiOperation({ summary: 'Get all reviews for a property' })
  getPropertyReviews(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.reviewsService.getPropertyReviews(propertyId, page, limit);
  }

  @Get('properties/:propertyId/summary')
  @Public()
  @ApiOperation({ summary: 'Get rating summary for a property' })
  getRatingSummary(@Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.reviewsService.getPropertyRatingSummary(propertyId);
  }

  @Get('users/:userId')
  @Public()
  @ApiOperation({ summary: 'Get reviews for a user (host or guest)' })
  getUserReviews(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.reviewsService.getUserReviews(userId, page, limit);
  }

  @Post(':id/respond')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Host responds to a review' })
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body('response') response: string,
  ) {
    return this.reviewsService.respondToReview(id, user.id, response);
  }
}
