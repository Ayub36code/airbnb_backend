import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) method: PaymentMethod;
  @ApiPropertyOptional({ description: 'Stripe payment method ID' }) @IsOptional() @IsString() paymentMethodId?: string;
  @ApiPropertyOptional({ description: 'MoMo phone number' }) @IsOptional() @IsString() momoPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ipAddress?: string;
}
