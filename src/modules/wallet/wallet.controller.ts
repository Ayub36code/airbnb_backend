import { Controller, Get, Post, Body, Query, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Wallet')
@ApiBearerAuth('JWT')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get wallet details and recent transactions' })
  getWallet(@CurrentUser() user: any) {
    return this.walletService.getWallet(user.id);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  getBalance(@CurrentUser() user: any) {
    return this.walletService.getBalance(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get wallet transaction history' })
  getTransactions(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.walletService.getTransactions(user.id, page, limit);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Request a wallet withdrawal' })
  withdraw(
    @CurrentUser() user: any,
    @Body() body: { amount: number; payoutAccountId: string },
  ) {
    return this.walletService.withdraw(user.id, body.amount, body.payoutAccountId);
  }

  @Post('payout-accounts')
  @ApiOperation({ summary: 'Add a payout account (bank, MoMo, PayPal)' })
  addPayoutAccount(@CurrentUser() user: any, @Body() data: any) {
    return this.walletService.addPayoutAccount(user.id, data);
  }

  @Get('payout-accounts')
  @ApiOperation({ summary: 'Get user payout accounts' })
  getPayoutAccounts(@CurrentUser() user: any) {
    return this.walletService.getPayoutAccounts(user.id);
  }
}
