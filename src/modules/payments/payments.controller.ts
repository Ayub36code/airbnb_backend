import {
  Controller, Post, Get, Body, Param, Query,
  Headers, RawBodyRequest, Req, ParseUUIDPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { RolesGuard } from '@common/guards/roles.guard';


// interface RawBodyRequest extends Request{
//   rawBody: RawBodyRequest;
// }
@ApiTags('Payments')
@Controller('payments')
@UseGuards(RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('bookings/:bookingId/pay')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Initiate payment for a booking' })
  initiatePayment(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: any,
    @Body() dto: CreatePaymentDto,
    @Req() req: Request,
  ) {
    dto.ipAddress = req.ip;
    return this.paymentsService.initiatePayment(bookingId, user.id, dto);
  }

  // @Public()
  // @Post('webhooks/stripe')
  // @ApiOperation({ summary: 'Stripe webhook endpoint' })
  // stripeWebhook(
  //   @Req() req: RawBodyRequest<Request>,
  //   @Headers('stripe-signature') signature: string,
  // ) {
  //   return this.paymentsService.handleStripeWebhook(req.rawBody, signature);
  // }

  @Post('paypal/capture/:orderId')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Capture PayPal payment after approval' })
  capturePaypal(
    @Param('orderId') orderId: string,
    @Body('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.paymentsService.capturePaypalPayment(orderId, paymentId);
  }

  @Get('momo/status/:referenceId')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Check MTN MoMo payment status' })
  checkMomoStatus(
    @Param('referenceId') referenceId: string,
    @Query('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.paymentsService.checkMomoStatus(referenceId, paymentId);
  }

  @Get(':id')
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get payment details' })
  getPaymentDetails(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.paymentsService.getPaymentDetails(id, user.id);
  }

  @Get()
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get transaction history' })
  getTransactionHistory(
    @CurrentUser() user: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.paymentsService.getTransactionHistory(user.id, page, limit);
  }
}
