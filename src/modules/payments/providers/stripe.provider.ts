import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeProvider {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeProvider.name);

  constructor(private configService: ConfigService) {
    const stripeKey = this.configService.get<string>('stripeKey');
    if (!stripeKey) {throw new Error('wrong Stripe key');}
    this.stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      typescript: true,
    })
  }

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    paymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      payment_method: params.paymentMethodId,
      confirm: !!params.paymentMethodId,
      automatic_payment_methods: params.paymentMethodId ? undefined : { enabled: true },
      metadata: params.metadata || {},
    });
  }

  async createRefund(chargeId: string, amount?: number): Promise<Stripe.Refund> {
    return this.stripe.refunds.create({
      charge: chargeId,
      ...(amount && { amount }),
    });
  }

  async createCustomer(email: string, name: string): Promise<Stripe.Customer> {
    return this.stripe.customers.create({ email, name });
  }

  async attachPaymentMethod(paymentMethodId: string, customerId: string) {
    return this.stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  }

  async createConnectedAccount(email: string, country: string): Promise<Stripe.Account> {
    return this.stripe.accounts.create({
      type: 'express',
      email,
      country,
      capabilities: { transfers: { requested: true } },
    });
  }

  async createTransfer(amount: number, currency: string, destination: string, metadata: any) {
    return this.stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      destination,
      metadata,
    });
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {throw new Error('wrong Stripe webhook secret');}
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  async retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.retrieve(id);
  }
}
