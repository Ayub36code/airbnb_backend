import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MomoProvider {
  private readonly logger = new Logger(MomoProvider.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly environment: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = configService.get<string>('MOMO_API_URL', 'https://proxy.momoapi.mtn.com');
    this.environment = configService.get<string>('MOMO_ENVIRONMENT', 'sandbox');

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Collection (Receive Payment) ──────────────────
  async requestToPay(params: {
    amount: number;
    currency: string;
    partyId?: string; // phone number
    externalId: string;
    payerMessage: string;
    payeeNote: string;
  }): Promise<{ referenceId: string }> {
    const referenceId = uuidv4();
    const accessToken = await this.getCollectionToken();

    await this.client.post(
      '/collection/v1_0/requesttopay',
      {
        amount: params.amount.toString(),
        currency: params.currency,
        externalId: params.externalId,
        payer: { partyIdType: 'MSISDN', partyId: params.partyId },
        payerMessage: params.payerMessage,
        payeeNote: params.payeeNote,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': this.environment,
          'Ocp-Apim-Subscription-Key': this.configService.get('MOMO_COLLECTION_PRIMARY_KEY'),
        },
      },
    );

    return { referenceId };
  }

  async getPaymentStatus(referenceId: string): Promise<any> {
    const accessToken = await this.getCollectionToken();

    const response = await this.client.get(
      `/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Target-Environment': this.environment,
          'Ocp-Apim-Subscription-Key': this.configService.get('MOMO_COLLECTION_PRIMARY_KEY'),
        },
      },
    );

    return response.data;
  }

  // ── Disbursement (Send Payment / Payout) ──────────
  async transfer(params: {
    amount: number;
    currency: string;
    partyId: string;
    externalId: string;
    payerMessage: string;
    payeeNote: string;
  }): Promise<{ referenceId: string }> {
    const referenceId = uuidv4();
    const accessToken = await this.getDisbursementToken();

    await this.client.post(
      '/disbursement/v1_0/transfer',
      {
        amount: params.amount.toString(),
        currency: params.currency,
        externalId: params.externalId,
        payee: { partyIdType: 'MSISDN', partyId: params.partyId },
        payerMessage: params.payerMessage,
        payeeNote: params.payeeNote,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': this.environment,
          'Ocp-Apim-Subscription-Key': this.configService.get('MOMO_DISBURSEMENT_PRIMARY_KEY'),
        },
      },
    );

    return { referenceId };
  }

  async refund(originalReferenceId: string | null, amount: number, currency: string) {
    const referenceId = uuidv4();
    const accessToken = await this.getCollectionToken();

    await this.client.post(
      '/collection/v1_0/refund',
      { amount: amount.toString(), currency, externalId: originalReferenceId },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': this.environment,
          'Ocp-Apim-Subscription-Key': this.configService.get('MOMO_COLLECTION_PRIMARY_KEY'),
        },
      },
    );

    return { referenceId };
  }

  // ── Private Token Helpers ─────────────────────────
  private async getCollectionToken(): Promise<string> {
    const userId = this.configService.get<string>('MOMO_COLLECTION_USER_ID');
    const apiKey = this.configService.get<string>('MOMO_COLLECTION_API_KEY');
    const primaryKey = this.configService.get<string>('MOMO_COLLECTION_PRIMARY_KEY');

    const credentials = Buffer.from(`${userId}:${apiKey}`).toString('base64');

    const response = await this.client.post(
      '/collection/token/',
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Ocp-Apim-Subscription-Key': primaryKey,
        },
      },
    );

    return response.data.access_token;
  }

  private async getDisbursementToken(): Promise<string> {
    const userId = this.configService.get<string>('MOMO_DISBURSEMENT_USER_ID');
    const apiKey = this.configService.get<string>('MOMO_DISBURSEMENT_API_KEY');
    const primaryKey = this.configService.get<string>('MOMO_DISBURSEMENT_PRIMARY_KEY');

    const credentials = Buffer.from(`${userId}:${apiKey}`).toString('base64');

    const response = await this.client.post(
      '/disbursement/token/',
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Ocp-Apim-Subscription-Key': primaryKey,
        },
      },
    );

    return response.data.access_token;
  }
}
