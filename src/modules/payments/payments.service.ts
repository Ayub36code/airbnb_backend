import {
  Injectable, BadRequestException, NotFoundException,
  Logger, InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StripeProvider } from './providers/stripe.provider';
import { PaypalProvider } from './providers/paypal.provider';
import { MomoProvider } from './providers/momo.provider';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentMethod, PaymentStatus, TransactionType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private stripeProvider: StripeProvider,
    private paypalProvider: PaypalProvider,
    private momoProvider: MomoProvider,
  ) {}

  // ── Initiate Payment ──────────────────────────────
  async initiatePayment(bookingId: string, userId: string, dto: CreatePaymentDto) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, guestId: userId },
      include: { payment: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.payment) throw new BadRequestException('Payment already exists for this booking');

    const paymentNumber = await this.generatePaymentNumber();

    const payment = await this.prisma.payment.create({
      data: {
        paymentNumber,
        bookingId,
        userId,
        amount: booking.totalAmount,
        currency: booking.currency,
        status: PaymentStatus.PENDING,
        method: dto.method,
        provider: this.getProvider(dto.method),
        ipAddress: dto.ipAddress,

      },
    });

    let providerResult: any;

    try {
      switch (dto.method) {
        case PaymentMethod.STRIPE_CARD:
        case PaymentMethod.STRIPE_BANK:
          providerResult = await this.stripeProvider.createPaymentIntent({
            amount: Math.round(booking.totalAmount * 100), // Stripe uses cents
            currency: booking.currency.toLowerCase(),
            paymentMethodId: dto.paymentMethodId,
            metadata: { bookingId, paymentId: payment.id, userId },
          });
          break;

        case PaymentMethod.PAYPAL:
          providerResult = await this.paypalProvider.createOrder({
            amount: booking.totalAmount,
            currency: booking.currency,
            bookingId,
            description: `Booking ${booking.bookingNumber}`,
          });
          break;

        case PaymentMethod.MTN_MOMO:
          providerResult = await this.momoProvider.requestToPay({
            amount: booking.totalAmount,
            currency: dto.currency || 'UGX',
            partyId: dto.momoPhone,
            externalId: payment.id,
            payerMessage: `Payment for booking ${booking.bookingNumber}`,
            payeeNote: `Rental booking ${booking.bookingNumber}`,
          });
          break;

        case PaymentMethod.WALLET:
          providerResult = await this.payFromWallet(userId, booking.totalAmount, booking.currency, bookingId);
          break;

        default:
          throw new BadRequestException('Unsupported payment method');
      }

      // Update payment with provider reference
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: providerResult.id || providerResult.referenceId,
          status: dto.method === PaymentMethod.WALLET ? PaymentStatus.COMPLETED : PaymentStatus.PROCESSING,
          ...(dto.method === PaymentMethod.WALLET && { capturedAt: new Date() }),
        },
      });

      // Log transaction
      await this.logTransaction(userId, payment.id, TransactionType.BOOKING_PAYMENT, booking.totalAmount, booking.currency);

      return {
        paymentId: payment.id,
        status: payment.status,
        clientSecret: providerResult.client_secret, // Stripe
        approvalUrl: providerResult.approvalUrl, // PayPal
        referenceId: providerResult.referenceId, // MoMo
        method: dto.method,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failedAt: new Date(), failureReason: error.message },
      });
      this.logger.error(`Payment initiation failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Payment processing failed');
    }
  }

  // ── Stripe Webhook Handler ─────────────────────────
  async handleStripeWebhook(payload: Buffer, signature: string) {
    const event = this.stripeProvider.constructWebhookEvent(payload, signature);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSuccess(event.data.object as any);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailure(event.data.object as any);
        break;
      case 'charge.dispute.created':
        await this.handleDispute(event.data.object as any);
        break;
    }

    return { received: true };
  }

  // ── PayPal Capture ────────────────────────────────
  async capturePaypalPayment(orderId: string, paymentId: string) {
    const result = await this.paypalProvider.captureOrder(orderId);
    if (result.status === 'COMPLETED') {
      await this.completePayment(paymentId, result.id);
    }
    return result;
  }

  // ── MoMo Status Check ─────────────────────────────
  async checkMomoStatus(referenceId: string, paymentId: string) {
    const status = await this.momoProvider.getPaymentStatus(referenceId);
    if (status.status === 'SUCCESSFUL') {
      await this.completePayment(paymentId, referenceId);
    } else if (status.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, failedAt: new Date(), failureReason: status.reason },
      });
    }
    return status;
  }

  // ── Process Refund ────────────────────────────────
  async processRefund(paymentId: string, amount: number, reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Can only refund completed payments');
    }

    let providerRefundId: string;

    try {
      switch (payment.provider) {
        case 'STRIPE':
          // const stripeRefund = await this.stripeProvider.createRefund(
          //   payment.providerChargeId || payment.providerPaymentId,
          //   Math.round(amount * 100),
          // );
          // providerRefundId = stripeRefund.id;
          // break;
        case 'PAYPAL':
          const paypalRefund = await this.paypalProvider.refundCapture(
            payment.providerPaymentId,
            amount,
            payment.currency,
          );
          providerRefundId = paypalRefund.id;
          break;
        case 'MTN_MOMO':
          const momoRefund = await this.momoProvider.refund(
            payment.providerPaymentId,
            amount,
            payment.currency,
          );
          providerRefundId = momoRefund.referenceId;
          break;
        case 'INTERNAL':
          // Wallet refund
          await this.prisma.wallet.update({
            where: { userId: payment.userId },
            data: { balance: { increment: amount } },
          });
          providerRefundId = uuidv4();
          break;
      }

      const refund = await this.prisma.refund.create({
        data: {
          paymentId,
          amount,
          currency: payment.currency,
          reason,
          status: PaymentStatus.COMPLETED,
          providerRefundId,
          processedAt: new Date(),
        },
      });

      // Update payment status
      const isFullRefund = amount >= payment.amount;
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          providerRefundId,
        },
      });

      await this.logTransaction(
        payment.userId, paymentId, TransactionType.REFUND,
        amount, payment.currency,
      );

      return refund;
    } catch (error) {
      this.logger.error(`Refund failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Refund processing failed');
    }
  }

  // ── Get Payment Details ───────────────────────────
  async getPaymentDetails(paymentId: string, userId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
      include: {
        transactions: true,
        refunds: true,
        booking: { select: { bookingNumber: true, checkIn: true, checkOut: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  // ── Transaction History ───────────────────────────
  async getTransactionHistory(userId: string, page = 1, limit = 20) {
    return this.prisma.paginate(
      this.prisma.transaction,
      {
        where: { userId },
        include: { payment: { select: { paymentNumber: true, method: true } } },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  // ── Private Helpers ───────────────────────────────
  private async handlePaymentSuccess(paymentIntent: any) {
    const payment = await this.prisma.payment.findFirst({
      where: { providerPaymentId: paymentIntent.id },
    });
    if (!payment) return;
    await this.completePayment(payment.id, paymentIntent.id);
  }

  private async handlePaymentFailure(paymentIntent: any) {
    await this.prisma.payment.updateMany({
      where: { providerPaymentId: paymentIntent.id },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        failureReason: paymentIntent.last_payment_error?.message,
      },
    });
  }

  private async handleDispute(charge: any) {
    const payment = await this.prisma.payment.findFirst({
      where: { providerChargeId: charge.id },
    });
    if (payment) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.DISPUTED },
      });
    }
  }

  private async completePayment(paymentId: string, providerRef: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: true },
    });
    if (!payment || payment.status === PaymentStatus.COMPLETED) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.COMPLETED,
          capturedAt: new Date(),
          providerChargeId: providerRef,
        },
      });

      // Confirm booking if pending
      if (payment.booking?.status === 'PENDING') {
        await tx.booking.update({
          where: { id: payment.bookingId },
          data: { status: 'CONFIRMED' },
        });
      }

      // Add host payout to pending balance
      if (payment.booking?.hostPayout) {
        await tx.wallet.update({
          where: { userId: payment.booking.hostId },
          data: { pendingBalance: { increment: payment.booking.hostPayout } },
        });
      }
    });
  }

  private async payFromWallet(userId: string, amount: number, currency: string, bookingId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new BadRequestException('Wallet not found');
    if (wallet.balance < amount) throw new BadRequestException('Insufficient wallet balance');

    await this.prisma.wallet.update({
      where: { userId },
      data: { balance: { decrement: amount } },
    });

    return { id: uuidv4(), status: 'COMPLETED' };
  }

  private async logTransaction(
    userId: string, paymentId: string, type: TransactionType,
    amount: number, currency: string,
  ) {
    await this.prisma.transaction.create({
      data: {
        userId, paymentId, type, amount, currency,
        status: PaymentStatus.COMPLETED,
        description: `${type} - ${amount} ${currency}`,
      },
    });
  }

  private getProvider(method: PaymentMethod): any {
    if (method === PaymentMethod.STRIPE_CARD || method === PaymentMethod.STRIPE_BANK) return 'STRIPE';
    if (method === PaymentMethod.PAYPAL) return 'PAYPAL';
    if (method === PaymentMethod.MTN_MOMO) return 'MTN_MOMO';
    return 'INTERNAL';
  }

  private async generatePaymentNumber(): Promise<string> {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `PAY${ts}${rnd}`;
  }
}
