import { registerAs } from '@nestjs/config';

const fee = process.env.STRIPE_PLATFORM_FEE_PERCENT
export default registerAs('stripe', () => ({
  secretKey: process.env.STRIPE_SECRET_KEY,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  platformFeePercent: fee ? parseFloat(fee) : 3,
}));
