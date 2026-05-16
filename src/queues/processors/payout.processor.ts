import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queues.module';
import { PrismaService } from '@modules/prisma/prisma.service';

@Processor('payouts')
export class PayoutQueueProcessor {
  private readonly logger = new Logger(PayoutQueueProcessor.name);

  constructor(private prisma: PrismaService) {}

  @Process('process-payout')
  async handlePayout(job: Job) {
    const { userId, amount, currency, bookingId } = job.data;

    this.logger.log(`Processing payout: ${amount} ${currency} for user ${userId}`);

    // Get host's default payout account
    const payoutAccount = await this.prisma.payoutAccount.findFirst({
      where: { userId, isDefault: true, isVerified: true },
    });

    if (!payoutAccount) {
      this.logger.warn(`No verified payout account for user ${userId}, holding funds in wallet`);
      // Funds stay in wallet
      return;
    }

    // Record the payout transaction
    await this.prisma.transaction.create({
      data: {
        userId,
        type: 'PAYOUT',
        amount,
        currency,
        status: 'COMPLETED',
        description: `Payout for booking ${bookingId}`,
        metadata: { payoutAccountId: payoutAccount.id, bookingId },
      },
    });

    this.logger.log(`Payout processed for booking ${bookingId}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Payout job ${job.id} failed: ${error.message}`);
  }
}
