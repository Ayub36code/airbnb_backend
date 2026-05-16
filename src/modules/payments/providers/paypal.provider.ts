import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class PaypalProvider {
  private readonly logger = new Logger(PaypalProvider.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    const mode = configService.get<string>('PAYPAL_MODE', 'sandbox');
    this.baseUrl = mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    this.client = axios.create({ baseURL: this.baseUrl });
  }

  async createOrder(params: {
    amount: number;
    currency: string;
    bookingId: string;
    description: string;
  }) {
    const token = await this.getAccessToken();
    const response = await this.client.post(
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: params.currency, value: params.amount.toFixed(2) },
          description: params.description,
          custom_id: params.bookingId,
        }],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const approvalUrl = response.data.links?.find((l: any) => l.rel === 'approve')?.href;
    return { id: response.data.id, status: response.data.status, approvalUrl };
  }

  async captureOrder(orderId: string) {
    const token = await this.getAccessToken();
    const response = await this.client.post(
      `/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
    return response.data;
  }

  async refundCapture(captureId: string | null, amount: number, currency: string) {
    const token = await this.getAccessToken();
    const response = await this.client.post(
      `/v2/payments/captures/${captureId}/refund`,
      { amount: { value: amount.toFixed(2), currency_code: currency } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
    return response.data;
  }

  private async getAccessToken(): Promise<string> {
    const clientId = this.configService.get<string>('PAYPAL_CLIENT_ID');
    const clientSecret = this.configService.get<string>('PAYPAL_CLIENT_SECRET');
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await this.client.post(
      '/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
    return response.data.access_token;
  }
}
