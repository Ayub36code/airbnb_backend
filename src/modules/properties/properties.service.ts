import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SearchService } from '../search/search.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyFilterDto } from './dto/property-filter.dto';
import { PropertyStatus, UserRole } from '@prisma/client';
import slugify from 'slugify';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);
  private readonly CACHE_TTL = 3600;

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private searchService: SearchService,
  ) {}

  // ── Create Property
  async create(hostId: string, dto: CreatePropertyDto) {
    const slug = await this.generateUniqueSlug(dto.title);

    const property = await this.prisma.property.create({
      data: {
        hostId,
        slug,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        postalCode: dto.postalCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
        maxGuests: dto.maxGuests,
        bedrooms: dto.bedrooms,
        beds: dto.beds,
        bathrooms: dto.bathrooms,
        squareMeters: dto.squareMeters,
        pricePerNight: dto.pricePerNight,
        cleaningFee: dto.cleaningFee,
        securityDeposit: dto.securityDeposit,
        weeklyDiscount: dto.weeklyDiscount,
        monthlyDiscount: dto.monthlyDiscount,
        currency: dto.currency || 'USD',
        minNights: dto.minNights || 1,
        maxNights: dto.maxNights,
        instantBook: dto.instantBook || false,
        petsAllowed: dto.petsAllowed || false,
        smokingAllowed: dto.smokingAllowed || false,
        eventsAllowed: dto.eventsAllowed || false,
        checkInTime: dto.checkInTime || '15:00',
        checkOutTime: dto.checkOutTime || '11:00',
        houseRules: dto.houseRules,
        cancellationPolicy: dto.cancellationPolicy || 'MODERATE',
        tags: dto.tags || [],
        status: PropertyStatus.DRAFT,
      },
      include: { images: true, amenities: { include: { amenity: true } } },
    });

    // Index in Elasticsearch
    await this.searchService.indexProperty(property).catch((e) =>
      this.logger.error('ES index error:', e),
    );

    return property;
  }

  // ── Get All (with filters) ────────────────────────
  async findAll(filters: PropertyFilterDto, userId?: string) {
    const cacheKey = `properties:list:${JSON.stringify(filters)}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) return cached;

    const {
      page = 1, limit = 20, city, country, minPrice, maxPrice,
      minGuests, checkIn, checkOut, type, amenities,
      sortBy = 'createdAt', sortOrder = 'desc',
    } = filters;

    const where: any = {
      status: PropertyStatus.ACTIVE,
      deletedAt: null,
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(country && { country }),
      ...(type && { type }),
      ...(minPrice !== undefined && { pricePerNight: { gte: minPrice } }),
      ...(maxPrice !== undefined && { pricePerNight: { ...( minPrice !== undefined ? { gte: minPrice } : {}), lte: maxPrice } }),
      ...(minGuests && { maxGuests: { gte: minGuests } }),
    };

    // Date-based availability filter
    if (checkIn && checkOut) {
      where.NOT = {
        OR: [
          { bookings: { some: { status: { in: ['CONFIRMED', 'CHECKED_IN'] }, checkIn: { lte: new Date(checkOut) }, checkOut: { gte: new Date(checkIn) } } } },
          { availability: { some: { startDate: { lte: new Date(checkOut) }, endDate: { gte: new Date(checkIn) } } } },
        ],
      };
    }

    // Amenity filter
    if (amenities?.length) {
      where.amenities = {
        some: { amenityId: { in: amenities } },
      };
    }

    const orderBy: any = sortBy === 'price'
      ? { pricePerNight: sortOrder }
      : sortBy === 'rating'
      ? { avgRating: sortOrder }
      : { [sortBy]: sortOrder };

    const result = await this.prisma.paginate(
      this.prisma.property,
      {
        where,
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          _count: { select: { reviews: true } },
        },
        orderBy,
      },
      page,
      Math.min(limit, 50),
    );

    await this.redisService.set(cacheKey, result, 300); // 5 min cache
    return result;
  }

  // ── Get Single Property ───────────────────────────
  async findOne(id: string, userId?: string) {
    const cacheKey = `property:${id}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      // Async view count increment
      this.incrementViewCount(id).catch(() => {});
      return cached;
    }

    const property = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        amenities: { include: { amenity: true } },
        host: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true,
            createdAt: true,
            profile: {
              select: {
                superhost: true, responseRate: true,
                avgResponseTime: true, hostSince: true,
              },
            },
          },
        },
        reviews: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            reviewer: { select: { id: true, firstName: true, avatarUrl: true } },
          },
        },
        _count: { select: { reviews: true, favorites: true } },
      },
    });

    if (!property) throw new NotFoundException('Property not found');

    // Check if the viewer has favorited
    let isFavorited = false;
    if (userId) {
      const fav = await this.prisma.favorite.findUnique({
        where: { userId_propertyId: { userId, propertyId: id } },
      });
      isFavorited = !!fav;
    }

    const result = { ...property, isFavorited };
    await this.redisService.set(cacheKey, result, this.CACHE_TTL);
    await this.incrementViewCount(id);

    return result;
  }

  // ── Update Property ───────────────────────────────
  async update(id: string, hostId: string, dto: UpdatePropertyDto, userRole: string) {
    const property = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!property) throw new NotFoundException('Property not found');

    if (property.hostId !== hostId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Not authorized to update this property');
    }

    const updated = await this.prisma.property.update({
      where: { id },
      data: {
        ...this.prisma.clean(dto),
        // Reset to pending review if price/details change
        ...(dto.pricePerNight && property.status === PropertyStatus.ACTIVE
          ? {} // Keep active, just update
          : {}),
        updatedAt: new Date(),
      },
      include: {
        images: true,
        amenities: { include: { amenity: true } },
      },
    });

    // Invalidate cache
    await this.redisService.del([`property:${id}`, `properties:list:*`]);
    await this.searchService.indexProperty(updated).catch(() => {});

    return updated;
  }

  // ── Delete Property ───────────────────────────────
  async remove(id: string, hostId: string, userRole: string) {
    const property = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!property) throw new NotFoundException('Property not found');

    if (property.hostId !== hostId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Not authorized');
    }

    // Soft delete - check for active bookings first
    const activeBookings = await this.prisma.booking.count({
      where: { propertyId: id, status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
    });
    if (activeBookings > 0) {
      throw new BadRequestException('Cannot delete property with active bookings');
    }

    await this.prisma.property.update({
      where: { id },
      data: { deletedAt: new Date(), status: PropertyStatus.ARCHIVED },
    });

    await this.redisService.del(`property:${id}`);
    await this.searchService.removeProperty(id).catch(() => {});

    return { message: 'Property deleted successfully' };
  }

  // ── Manage Amenities ──────────────────────────────
  async setAmenities(propertyId: string, hostId: string, amenityIds: string[]) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, hostId },
    });
    if (!property) throw new NotFoundException('Property not found');

    await this.prisma.$transaction([
      this.prisma.propertyAmenity.deleteMany({ where: { propertyId } }),
      this.prisma.propertyAmenity.createMany({
        data: amenityIds.map((amenityId) => ({ propertyId, amenityId })),
        skipDuplicates: true,
      }),
    ]);

    await this.redisService.del(`property:${propertyId}`);
    return { message: 'Amenities updated' };
  }

  // ── Availability Calendar ─────────────────────────
  async getAvailability(propertyId: string, year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const [blocks, bookings, pricingRules] = await Promise.all([
      this.prisma.availabilityBlock.findMany({
        where: {
          propertyId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          propertyId,
          status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING'] },
          checkIn: { lte: endDate },
          checkOut: { gte: startDate },
        },
        select: { checkIn: true, checkOut: true, status: true },
      }),
      this.prisma.pricingRule.findMany({
        where: {
          propertyId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
    ]);

    return { blocks, bookings, pricingRules };
  }

  // ── Block Availability ────────────────────────────
  async blockDates(propertyId: string, hostId: string, startDate: Date, endDate: Date, reason?: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, hostId } });
    if (!property) throw new NotFoundException('Property not found');

    // Check for existing bookings in this range
    const conflict = await this.prisma.booking.findFirst({
      where: {
        propertyId,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lte: endDate },
        checkOut: { gte: startDate },
      },
    });
    if (conflict) throw new BadRequestException('Cannot block dates with existing confirmed bookings');

    return this.prisma.availabilityBlock.create({
      data: { propertyId, startDate, endDate, reason },
    });
  }

  // ── Host Properties ───────────────────────────────
  async getHostProperties(hostId: string, page: number = 1, limit: number = 10) {
    return this.prisma.paginate(
      this.prisma.property,
      {
        where: { hostId, deletedAt: null },
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          _count: { select: { bookings: true, reviews: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  // ── Pricing Calculator ────────────────────────────
  async calculatePrice(propertyId: string, checkIn: Date, checkOut: Date, guests: number) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, status: PropertyStatus.ACTIVE },
    });
    if (!property) throw new NotFoundException('Property not found');

    const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / 86400000);
    if (nights < property.minNights) {
      throw new BadRequestException(`Minimum stay is ${property.minNights} nights`);
    }

    // Check for custom pricing rules
    const pricingRule = await this.prisma.pricingRule.findFirst({
      where: {
        propertyId,
        startDate: { lte: checkIn },
        endDate: { gte: checkOut },
      },
    });

    const pricePerNight = pricingRule?.pricePerNight || property.pricePerNight;
    let subtotal = pricePerNight * nights;

    // Apply discounts
    let discountAmount = 0;
    if (nights >= 28 && property.monthlyDiscount) {
      discountAmount = subtotal * (property.monthlyDiscount / 100);
    } else if (nights >= 7 && property.weeklyDiscount) {
      discountAmount = subtotal * (property.weeklyDiscount / 100);
    }
    subtotal -= discountAmount;

    const cleaningFee = property.cleaningFee || 0;
    const serviceFee = subtotal * (property.serviceFeePercent / 100);
    const taxes = (subtotal + cleaningFee + serviceFee) * 0.1; // 10% tax estimate
    const totalAmount = subtotal + cleaningFee + serviceFee + taxes;
    const hostPayout = subtotal + cleaningFee - (subtotal * 0.03); // 3% host fee

    return {
      nights,
      pricePerNight,
      subtotal,
      cleaningFee,
      serviceFee,
      taxes,
      discountAmount,
      totalAmount,
      hostPayout,
      currency: property.currency,
      breakdown: {
        baseRate: `${pricePerNight} x ${nights} nights`,
        discount: discountAmount > 0 ? `-${discountAmount.toFixed(2)}` : null,
      },
    };
  }

  // ── Favorites ─────────────────────────────────────
  async toggleFavorite(propertyId: string, userId: string) {
    const existing = await this.prisma.favorite.findUnique({
      where: { userId_propertyId: { userId, propertyId } },
    });

    if (existing) {
      await this.prisma.favorite.delete({
        where: { userId_propertyId: { userId, propertyId } },
      });
      await this.prisma.property.update({
        where: { id: propertyId },
        data: { favoritesCount: { decrement: 1 } },
      });
      return { favorited: false };
    }

    await this.prisma.favorite.create({ data: { userId, propertyId } });
    await this.prisma.property.update({
      where: { id: propertyId },
      data: { favoritesCount: { increment: 1 } },
    });
    return { favorited: true };
  }

  async getUserFavorites(userId: string, page: number = 1, limit: number = 20) {
    return this.prisma.paginate(
      this.prisma.favorite,
      {
        where: { userId },
        include: {
          property: {
            include: { images: { where: { isPrimary: true }, take: 1 } },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  // ── Admin Actions ─────────────────────────────────
  async approve(propertyId: string, adminId: string) {
    const property = await this.prisma.property.update({
      where: { id: propertyId },
      data: { status: PropertyStatus.ACTIVE, approvedAt: new Date(), approvedBy: adminId },
    });
    await this.redisService.del(`property:${propertyId}`);
    return property;
  }

  async suspend(propertyId: string, adminId: string, reason: string) {
    const property = await this.prisma.property.update({
      where: { id: propertyId },
      data: { status: PropertyStatus.SUSPENDED, suspendedAt: new Date(), suspendedReason: reason },
    });
    await this.redisService.del(`property:${propertyId}`);
    return property;
  }

  // ── Private Helpers ───────────────────────────────
  private async generateUniqueSlug(title: string): Promise<string> {
    const base = slugify(title, { lower: true, strict: true });
    let slug = base;
    let counter = 0;
    while (await this.prisma.property.findUnique({ where: { slug } })) {
      slug = `${base}-${++counter}`;
    }
    return slug;
  }

  private async incrementViewCount(propertyId: string): Promise<void> {
    await this.prisma.property.update({
      where: { id: propertyId },
      data: { viewCount: { increment: 1 } },
    }).catch(() => {});
  }
}
