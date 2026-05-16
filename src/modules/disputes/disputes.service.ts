import {
  Injectable, NotFoundException, BadRequestException,
  ForbiddenException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { DisputeStatus, UserRole } from '@prisma/client';

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
  ) {}

  async openDispute(userId: string, data: {
    bookingId: string;
    category: string;
    description: string;
    evidence?: any;
  }) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: data.bookingId },
      include: { dispute: true, payment: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.guestId !== userId && booking.hostId !== userId) {
      throw new ForbiddenException('Not authorized to open dispute for this booking');
    }
    if (booking.dispute) throw new BadRequestException('Dispute already exists for this booking');

    const allowedStatuses = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'];
    if (!allowedStatuses.includes(booking.status)) {
      throw new BadRequestException(`Cannot open dispute for booking with status: ${booking.status}`);
    }

    const disputeNumber = `DSP-${Date.now().toString(36).toUpperCase()}`;

    const dispute = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.create({
        data: {
          disputeNumber,
          bookingId: data.bookingId,
          raisedById: userId,
          category: data.category,
          description: data.description,
          evidence: data.evidence,
          status: DisputeStatus.OPEN,
        },
      });

      // Update booking status to DISPUTED
      await tx.booking.update({
        where: { id: data.bookingId },
        data: { status: 'DISPUTED' },
      });

      // Hold any pending payouts
      if (booking.payment?.status === 'COMPLETED') {
        await tx.wallet.update({
          where: { userId: booking.hostId },
          data: { pendingBalance: { decrement: booking.hostPayout || 0 } },
        }).catch(() => {}); // May not exist yet
      }

      return d;
    });

    this.logger.log(`Dispute opened: ${disputeNumber} for booking ${data.bookingId}`);
    return dispute;
  }

  async findOne(disputeId: string, userId: string, userRole: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        booking: {
          include: {
            property: { select: { title: true } },
            guest: { select: { id: true, firstName: true, lastName: true } },
            host: { select: { id: true, firstName: true, lastName: true } },
            payment: true,
          },
        },
        raisedBy: { select: { id: true, firstName: true, lastName: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    const booking = dispute.booking;
    if (
      userRole !== UserRole.ADMIN &&
      booking.guestId !== userId &&
      booking.hostId !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return dispute;
  }

  async getUserDisputes(userId: string, page = 1, limit = 10) {
    return this.prisma.paginate(
      this.prisma.dispute,
      {
        where: {
          booking: { OR: [{ guestId: userId }, { hostId: userId }] },
        },
        include: {
          booking: { select: { bookingNumber: true, checkIn: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page, limit,
    );
  }

  async addMessage(disputeId: string, senderId: string, content: string, isInternal = false) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { booking: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    return this.prisma.disputeMessage.create({
      data: { disputeId, senderId, content, isInternal },
    });
  }

  // Admin: resolve dispute
  async resolve(
    disputeId: string,
    adminId: string,
    decision: 'HOST' | 'GUEST',
    resolution: string,
    refundAmount?: number,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { booking: { include: { payment: true } } },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status === DisputeStatus.CLOSED) {
      throw new BadRequestException('Dispute is already closed');
    }

    const newStatus = decision === 'GUEST'
      ? DisputeStatus.RESOLVED_GUEST
      : DisputeStatus.RESOLVED_HOST;

    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: newStatus,
          resolution,
          resolvedAt: new Date(),
          resolvedBy: adminId,
          refundAmount,
        },
      });

      // Process refund if decided in guest's favor
      if (decision === 'GUEST' && refundAmount && dispute.booking.payment?.id) {
        await this.paymentsService.processRefund(
          dispute.booking.payment.id,
          refundAmount,
          `Dispute resolved in guest's favor: ${resolution}`,
        );
      }

      // Release payout if decided in host's favor
      if (decision === 'HOST' && dispute.booking.hostPayout) {
        await tx.wallet.update({
          where: { userId: dispute.booking.hostId },
          data: {
            balance: { increment: dispute.booking.hostPayout },
          },
        });
      }

      // Update booking
      await tx.booking.update({
        where: { id: dispute.bookingId },
        data: { status: 'CHECKED_OUT' },
      });
    });

    return { message: `Dispute resolved in favor of ${decision}`, resolution };
  }

  async escalate(disputeId: string, adminId: string, notes: string) {
    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: DisputeStatus.ESCALATED, assignedTo: adminId, notes },
    });
  }

  // Admin: list all disputes
  async getAllDisputes(status?: DisputeStatus, page = 1, limit = 20) {
    return this.prisma.paginate(
      this.prisma.dispute,
      {
        where: status ? { status } : {},
        include: {
          booking: {
            include: {
              guest: { select: { firstName: true, lastName: true } },
              host: { select: { firstName: true, lastName: true } },
            },
          },
          raisedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      page, limit,
    );
  }
}
