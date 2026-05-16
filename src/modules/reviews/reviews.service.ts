import {
  Injectable, NotFoundException, BadRequestException,
  ForbiddenException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewType } from '@prisma/client';

@Injectable()
export class ReviewsService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(reviewerId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { review: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'CHECKED_OUT') {
      throw new BadRequestException('Can only review after check-out');
    }

    // Check reviewer is part of the booking
    const isGuest = booking.guestId === reviewerId;
    const isHost = booking.hostId === reviewerId;
    if (!isGuest && !isHost) throw new ForbiddenException('Not part of this booking');

    // Check review window (14 days after checkout)
    if (!booking.checkedOutAt) {throw new Error('booking not checked');}
    const daysSinceCheckout = (Date.now() - booking.checkedOutAt.getTime()) / 86400000;
    if (daysSinceCheckout > 14) throw new BadRequestException('Review window has closed (14 days)');

    // Check existing review for this type
    const reviewType = isGuest ? ReviewType.GUEST_TO_PROPERTY : ReviewType.HOST_TO_GUEST;
    const existingReview = await this.prisma.review.findFirst({
      where: { bookingId: dto.bookingId, reviewerId, type: reviewType },
    });
    if (existingReview) throw new ConflictException('Review already submitted');

    const review = await this.prisma.$transaction(async (tx) => {
      const newReview = await tx.review.create({
        data: {
          bookingId: dto.bookingId,
          propertyId: isGuest ? booking.propertyId : null,
          reviewerId,
          revieweeId: isGuest ? booking.hostId : booking.guestId,
          type: reviewType,
          overallRating: dto.overallRating,
          cleanlinessRating: dto.cleanlinessRating,
          accuracyRating: dto.accuracyRating,
          locationRating: dto.locationRating,
          valueRating: dto.valueRating,
          communicationRating: dto.communicationRating,
          checkinRating: dto.checkinRating,
          comment: dto.comment,
        },
      });

      // Update property average rating
      if (isGuest) {
        const stats = await tx.review.aggregate({
          where: { propertyId: booking.propertyId, type: ReviewType.GUEST_TO_PROPERTY, isPublic: true },
          _avg: { overallRating: true },
          _count: { id: true },
        });

        await tx.property.update({
          where: { id: booking.propertyId },
          data: {
            avgRating: stats._avg.overallRating,
            totalReviews: stats._count.id,
          },
        });
      }

      return newReview;
    });

    await this.redisService.del(`property:${booking.propertyId}`);
    return review;
  }

  async getPropertyReviews(propertyId: string, page = 1, limit = 10) {
    return this.prisma.paginate(
      this.prisma.review,
      {
        where: { propertyId, isPublic: true, type: ReviewType.GUEST_TO_PROPERTY },
        include: {
          reviewer: { select: { id: true, firstName: true, avatarUrl: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  async getUserReviews(userId: string, page = 1, limit = 10) {
    return this.prisma.paginate(
      this.prisma.review,
      {
        where: { revieweeId: userId, isPublic: true },
        include: {
          reviewer: { select: { id: true, firstName: true, avatarUrl: true } },
          booking: { select: { checkIn: true, checkOut: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  async respondToReview(reviewId: string, hostId: string, response: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');

    const booking = await this.prisma.booking.findUnique({ where: { id: review.bookingId } });
    if (!booking) {throw new Error('Review not found');}
    if (booking.hostId !== hostId) throw new ForbiddenException('Not authorized');
    if (review.response) throw new BadRequestException('Already responded to this review');

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { response, respondedAt: new Date() },
    });
  }

  async getPropertyRatingSummary(propertyId: string) {
    const stats = await this.prisma.review.aggregate({
      where: { propertyId, isPublic: true, type: ReviewType.GUEST_TO_PROPERTY },
      _avg: {
        overallRating: true, cleanlinessRating: true, accuracyRating: true,
        locationRating: true, valueRating: true, communicationRating: true, checkinRating: true,
      },
      _count: { id: true },
    });

    // Rating distribution
    const distribution = await this.prisma.$queryRaw`
      SELECT ROUND("overallRating") as rating, COUNT(*) as count
      FROM reviews
      WHERE "propertyId" = ${propertyId}
        AND "isPublic" = true
        AND type = 'GUEST_TO_PROPERTY'
      GROUP BY ROUND("overallRating")
      ORDER BY rating DESC
    `;

    return { stats, distribution };
  }
}
