import {
  Injectable, NotFoundException, BadRequestException,
  ForbiddenException, ConflictException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingStatus, PropertyStatus, UserRole } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import * as dayjs from 'dayjs';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private notificationsService: NotificationsService,
    private paymentsService: PaymentsService,
  ) {}

  // ── Create Booking (with ACID double-booking prevention) ──
  async create(guestId: string, dto: CreateBookingDto) {
    const checkIn = new Date(dto.checkIn);
    const checkOut = new Date(dto.checkOut);

    if (checkIn >= checkOut) throw new BadRequestException('Check-out must be after check-in');
    if (checkIn < new Date()) throw new BadRequestException('Check-in cannot be in the past');

    const nights = dayjs(checkOut).diff(dayjs(checkIn), 'day');

    // ── Distributed lock to prevent race conditions ──────────
    const lockKey = `booking-lock:${dto.propertyId}:${dto.checkIn}:${dto.checkOut}`;
    const lockToken = await this.redisService.acquireLock(lockKey, 30, 5, 200);
    if (!lockToken) throw new ConflictException('Property is being booked. Please try again');

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Fetch property with a FOR UPDATE lock
        const property = await tx.property.findFirst({
          where: { id: dto.propertyId, status: PropertyStatus.ACTIVE, deletedAt: null },
        });
        if (!property) throw new NotFoundException('Property not found or not available');
        if (property.hostId === guestId) throw new BadRequestException('Cannot book your own property');
        if (dto.guests > property.maxGuests) {
          throw new BadRequestException(`Maximum ${property.maxGuests} guests allowed`);
        }
        if (nights < property.minNights) {
          throw new BadRequestException(`Minimum stay is ${property.minNights} nights`);
        }
        if (property.maxNights && nights > property.maxNights) {
          throw new BadRequestException(`Maximum stay is ${property.maxNights} nights`);
        }

        // 2. Check for conflicting bookings (SERIALIZABLE transaction handles isolation)
        const conflict = await tx.booking.findFirst({
          where: {
            propertyId: dto.propertyId,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
            checkIn: { lt: checkOut },
            checkOut: { gt: checkIn },
          },
        });
        if (conflict) throw new ConflictException('Property is not available for selected dates');

        // 3. Check availability blocks
        const blocked = await tx.availabilityBlock.findFirst({
          where: {
            propertyId: dto.propertyId,
            startDate: { lte: checkOut },
            endDate: { gte: checkIn },
          },
        });
        if (blocked) throw new ConflictException('Property is not available for selected dates');

        // 4. Calculate pricing
        const priceBreakdown = await this.calculateBookingPrice(property, checkIn, checkOut, nights, tx);

        // 5. Create booking
        const bookingNumber = await this.generateBookingNumber();
        const booking = await tx.booking.create({
          data: {
            bookingNumber,
            propertyId: dto.propertyId,
            guestId,
            hostId: property.hostId,
            checkIn,
            checkOut,
            nights,
            adultsCount: dto.adultsCount || dto.guests,
            childrenCount: dto.childrenCount || 0,
            infantsCount: dto.infantsCount || 0,
            petsCount: dto.petsCount || 0,
            pricePerNight: priceBreakdown.pricePerNight,
            subtotal: priceBreakdown.subtotal,
            cleaningFee: priceBreakdown.cleaningFee,
            securityDeposit: priceBreakdown.securityDeposit,
            serviceFee: priceBreakdown.serviceFee,
            taxes: priceBreakdown.taxes,
            discountAmount: priceBreakdown.discountAmount,
            totalAmount: priceBreakdown.totalAmount,
            hostPayout: priceBreakdown.hostPayout,
            currency: property.currency,
            guestMessage: dto.guestMessage,
            specialRequests: dto.specialRequests,
            status: property.instantBook ? BookingStatus.CONFIRMED : BookingStatus.PENDING,
          },
        });

        // 6. Log status history
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            toStatus: booking.status,
            changedBy: guestId,
            reason: 'Booking created',
          },
        });

        // 7. Update property stats
        await tx.property.update({
          where: { id: dto.propertyId },
          data: { totalBookings: { increment: 1 } },
        });

        return booking;
      }, { isolationLevel: 'Serializable' });
    } finally {
      await this.redisService.releaseLock(lockKey, lockToken);
    }
  }

  // ── Get Booking ───────────────────────────────────
  async findOne(id: string, userId: string, userRole: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        property: {
          include: { images: { where: { isPrimary: true }, take: 1 } },
        },
        guest: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
        host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
        payment: true,
        review: true,
        conversation: true,
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    // Authorization check
    if (
      userRole !== UserRole.ADMIN &&
      booking.guestId !== userId &&
      booking.hostId !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return booking;
  }

  // ── List Guest Bookings ───────────────────────────
  async getGuestBookings(guestId: string, status?: string, page = 1, limit = 10) {
    return this.prisma.paginate(
      this.prisma.booking,
      {
        where: {
          guestId,
          ...(status && { status: status as BookingStatus }),
        },
        include: {
          property: {
            include: { images: { where: { isPrimary: true }, take: 1 } },
          },
          payment: { select: { status: true, totalAmount: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  // ── List Host Bookings ────────────────────────────
  async getHostBookings(hostId: string, status?: string, page = 1, limit = 10) {
    return this.prisma.paginate(
      this.prisma.booking,
      {
        where: {
          hostId,
          ...(status && { status: status as BookingStatus }),
        },
        include: {
          property: { select: { id: true, title: true } },
          guest: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          payment: { select: { status: true, amount: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  // ── Confirm Booking (host action) ─────────────────
  async confirm(bookingId: string, hostId: string) {
    const booking = await this.getBookingOrThrow(bookingId);
    if (booking.hostId !== hostId) throw new ForbiddenException('Not authorized');
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(`Cannot confirm booking with status: ${booking.status}`);
    }

    return this.updateBookingStatus(bookingId, BookingStatus.CONFIRMED, hostId, 'Host confirmed');
  }

  // ── Reject Booking (host action) ──────────────────
  async reject(bookingId: string, hostId: string, reason: string) {
    const booking = await this.getBookingOrThrow(bookingId);
    if (booking.hostId !== hostId) throw new ForbiddenException('Not authorized');
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(`Cannot reject booking with status: ${booking.status}`);
    }

    const updated = await this.updateBookingStatus(bookingId, BookingStatus.REJECTED, hostId, reason);

    // Trigger refund if already paid
    if (booking.payment?.status === 'COMPLETED') {
      await this.paymentsService.processRefund(booking.payment.id, booking.totalAmount, 'Host rejected booking');
    }

    return updated;
  }

  // ── Check-In ──────────────────────────────────────
  async checkIn(bookingId: string, userId: string, userRole: string) {
    const booking = await this.getBookingOrThrow(bookingId);

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Booking must be confirmed before check-in');
    }
    if (userRole !== UserRole.ADMIN && booking.hostId !== userId) {
      throw new ForbiddenException('Only host or admin can confirm check-in');
    }

    const today = dayjs().startOf('day');
    const checkIn = dayjs(booking.checkIn);
    if (checkIn.isAfter(today.add(1, 'day'))) {
      throw new BadRequestException('Too early to check in');
    }

    const checkInCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CHECKED_IN,
        checkedInAt: new Date(),
        checkInCode,
      },
    });

    await this.createStatusHistory(bookingId, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, userId);

    // Notify guest
    await this.notificationsService.sendBookingNotification(
      booking.guestId, 'BOOKING_CONFIRMED', booking.id, { checkInCode },
    );

    return { message: 'Check-in recorded', checkInCode };
  }

  // ── Check-Out ─────────────────────────────────────
  async checkOut(bookingId: string, userId: string, userRole: string) {
    const booking = await this.getBookingOrThrow(bookingId);

    if (booking.status !== BookingStatus.CHECKED_IN) {
      throw new BadRequestException('Guest has not checked in yet');
    }
    if (userRole !== UserRole.ADMIN && booking.hostId !== userId) {
      throw new ForbiddenException('Only host or admin can confirm check-out');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CHECKED_OUT, checkedOutAt: new Date() },
      });

      // Release host payout from pending
      if (booking.payment?.status === 'COMPLETED' && booking.hostPayout) {
        await tx.wallet.update({
          where: { userId: booking.hostId },
          data: {
            pendingBalance: { decrement: booking.hostPayout },
            balance: { increment: booking.hostPayout },
          },
        });
      }
    });

    await this.createStatusHistory(bookingId, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT, userId);

    return { message: 'Check-out recorded successfully' };
  }

  // ── Cancel Booking ────────────────────────────────
  async cancel(bookingId: string, userId: string, userRole: string, reason: string) {
    const booking = await this.getBookingOrThrow(bookingId);

    const canCancel = [BookingStatus.PENDING, BookingStatus.CONFIRMED].includes('PENDING');
    if (!canCancel) throw new BadRequestException(`Cannot cancel booking with status: ${booking.status}`);

    const isGuest = booking.guestId === userId;
    const isHost = booking.hostId === userId;
    const isAdmin = userRole === UserRole.ADMIN;

    if (!isGuest && !isHost && !isAdmin) throw new ForbiddenException('Not authorized');

    // Calculate refund based on cancellation policy
    const { refundAmount, penaltyAmount } = await this.calculateCancellationRefund(booking);

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: userId,
          cancellationReason: reason,
          refundAmount,
          penaltyAmount,
        },
      });

      // Process refund
      if (refundAmount > 0 && booking.payment?.status === 'COMPLETED') {
        await this.paymentsService.processRefund(booking.payment.id, refundAmount, `Cancellation: ${reason}`);
      }
    });

    await this.createStatusHistory(bookingId, booking.status, BookingStatus.CANCELLED, userId, reason);

    return { message: 'Booking cancelled', refundAmount, penaltyAmount };
  }

  // ── Generate Invoice ──────────────────────────────
  async getInvoice(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        property: { select: { title: true, address: true, city: true, country: true } },
        guest: { select: { firstName: true, lastName: true, email: true } },
        host: { select: { firstName: true, lastName: true } },
        payment: true,
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.guestId !== userId && booking.hostId !== userId) throw new ForbiddenException();

    return {
      invoiceNumber: `INV-${booking.bookingNumber}`,
      issuedAt: new Date().toISOString(),
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        property: booking.property,
        guest: booking.guest,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: booking.nights,
      },
      lineItems: [
        { description: `${booking.property.title} - ${booking.nights} night(s)`, amount: booking.subtotal },
        ...(booking.cleaningFee ? [{ description: 'Cleaning fee', amount: booking.cleaningFee }] : []),
        { description: 'Service fee', amount: booking.serviceFee },
        { description: 'Taxes', amount: booking.taxes },
        ...(booking.discountAmount ? [{ description: 'Discount', amount: -booking.discountAmount }] : []),
      ],
      total: { amount: booking.totalAmount, currency: booking.currency },
      payment: booking.payment,
    };
  }

  // ── Private Helpers ───────────────────────────────
  private async getBookingOrThrow(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async updateBookingStatus(
    bookingId: string,
    status: BookingStatus,
    changedBy: string,
    reason?: string,
  ) {
    const [updated] = await this.prisma.$transaction([
      this.prisma.booking.update({ where: { id: bookingId }, data: { status } }),
      this.prisma.bookingStatusHistory.create({
        data: { bookingId, toStatus: status, changedBy, reason },
      }),
    ]);
    return updated;
  }

  private async createStatusHistory(
    bookingId: string,
    from: BookingStatus,
    to: BookingStatus,
    changedBy: string,
    reason?: string,
  ) {
    await this.prisma.bookingStatusHistory.create({
      data: { bookingId, fromStatus: from, toStatus: to, changedBy, reason },
    });
  }

  private async calculateBookingPrice(property: any, checkIn: Date, checkOut: Date, nights: number, tx: any) {
    const pricingRule = await tx.pricingRule.findFirst({
      where: { propertyId: property.id, startDate: { lte: checkIn }, endDate: { gte: checkOut } },
    });

    const pricePerNight = pricingRule?.pricePerNight || property.pricePerNight;
    let subtotal = pricePerNight * nights;
    let discountAmount = 0;

    if (nights >= 28 && property.monthlyDiscount) {
      discountAmount = subtotal * (property.monthlyDiscount / 100);
    } else if (nights >= 7 && property.weeklyDiscount) {
      discountAmount = subtotal * (property.weeklyDiscount / 100);
    }
    subtotal -= discountAmount;

    const cleaningFee = property.cleaningFee || 0;
    const securityDeposit = property.securityDeposit || 0;
    const serviceFeeRate = property.serviceFeePercent / 100;
    const serviceFee = subtotal * serviceFeeRate;
    const taxes = (subtotal + cleaningFee) * 0.1;
    const totalAmount = subtotal + cleaningFee + serviceFee + taxes;
    const hostPayout = subtotal + cleaningFee - (subtotal * 0.03);

    return { pricePerNight, subtotal, cleaningFee, securityDeposit, serviceFee, taxes, discountAmount, totalAmount, hostPayout };
  }

  private async calculateCancellationRefund(booking: any) {
    const property = await this.prisma.property.findUnique({ where: { id: booking.propertyId } });
    const daysUntilCheckIn = dayjs(booking.checkIn).diff(dayjs(), 'day');
    const paidAmount = booking.totalAmount;
    if (!property) {throw new Error('property not found');}

    let refundPercent = 0;
    switch (property.cancellationPolicy) {
      case 'FLEXIBLE':
        refundPercent = daysUntilCheckIn >= 1 ? 100 : 0;
        break;
      case 'MODERATE':
        refundPercent = daysUntilCheckIn >= 5 ? 100 : daysUntilCheckIn >= 1 ? 50 : 0;
        break;
      case 'STRICT':
        refundPercent = daysUntilCheckIn >= 14 ? 100 : daysUntilCheckIn >= 7 ? 50 : 0;
        break;
      case 'SUPER_STRICT_30':
        refundPercent = daysUntilCheckIn >= 30 ? 50 : 0;
        break;
      case 'SUPER_STRICT_60':
        refundPercent = daysUntilCheckIn >= 60 ? 50 : 0;
        break;
    }

    const refundAmount = (paidAmount * refundPercent) / 100;
    const penaltyAmount = paidAmount - refundAmount;
    return { refundAmount, penaltyAmount };
  }

  private async generateBookingNumber(): Promise<string> {
    const prefix = 'BK';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }
}
