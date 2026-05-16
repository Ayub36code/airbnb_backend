import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, PaymentStatus } from '@prisma/client';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private prisma: PrismaService) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true, pendingBalance: true, currency: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async topUp(userId: string, amount: number, currency: string, paymentReference: string) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amount } },
      });

      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: TransactionType.WALLET_TOPUP,
          amount,
          currency,
          status: PaymentStatus.COMPLETED,
          description: `Wallet top-up via ${paymentReference}`,
          balanceBefore: wallet.balance - amount,
          balanceAfter: wallet.balance,
        },
      });

      return wallet;
    });
  }

  async withdraw(userId: string, amount: number, payoutAccountId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.balance < amount) throw new BadRequestException('Insufficient balance');

    const payoutAccount = await this.prisma.payoutAccount.findFirst({
      where: { id: payoutAccountId, userId, isVerified: true },
    });
    if (!payoutAccount) throw new NotFoundException('Payout account not found or not verified');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } },
      });

      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: TransactionType.WALLET_WITHDRAWAL,
          amount,
          currency: wallet.currency,
          status: PaymentStatus.PENDING,
          description: `Withdrawal to account ${payoutAccountId}`,
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance - amount,
          metadata: { payoutAccountId },
        },
      });

      return { success: true, newBalance: updated.balance, message: 'Withdrawal initiated' };
    });
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return this.prisma.paginate(
      this.prisma.transaction,
      {
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
      },
      page,
      limit,
    );
  }

  async addPayoutAccount(userId: string, data: {
    provider: string;
    accountType: string;
    accountDetails: any;
    currency: string;
    isDefault?: boolean;
  }) {
    if (data.isDefault) {
      await this.prisma.payoutAccount.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    return this.prisma.payoutAccount.create({
      data: {
        userId,
        provider: data.provider,
        accountType: data.accountType,
        accountDetails: data.accountDetails,
        currency: data.currency,
        isDefault: data.isDefault || false,
      },
    });
  }

  async getPayoutAccounts(userId: string) {
    return this.prisma.payoutAccount.findMany({
      where: { userId },
      select: {
        id: true, provider: true, accountType: true,
        currency: true, isDefault: true, isVerified: true, createdAt: true,
        // Don't expose full account details
        accountDetails: false,
      },
    });
  }

  // Internal transfer (e.g., host payout)
  async internalTransfer(fromUserId: string, toUserId: string, amount: number, currency: string, description: string) {
    return this.prisma.$transaction(async (tx) => {
      const fromWallet = await tx.wallet.findUnique({ where: { userId: fromUserId } });
      if (!fromWallet || fromWallet.balance < amount) {
        throw new BadRequestException('Insufficient balance');
      }

      await tx.wallet.update({ where: { userId: fromUserId }, data: { balance: { decrement: amount } } });
      await tx.wallet.update({ where: { userId: toUserId }, data: { balance: { increment: amount } } });

      await tx.transaction.createMany({
        data: [
          {
            userId: fromUserId, walletId: fromWallet.id,
            type: TransactionType.PAYOUT, amount: -amount, currency,
            status: PaymentStatus.COMPLETED, description,
          },
          {
            userId: toUserId,
            type: TransactionType.PAYOUT, amount, currency,
            status: PaymentStatus.COMPLETED, description,
          },
        ],
      });
    });
  }
}
