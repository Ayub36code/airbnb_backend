import { IsString, IsDateString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBookingDto {
  @ApiProperty() @IsString() propertyId: string;
  @ApiProperty({ example: '2025-06-01' }) @IsDateString() checkIn: string;
  @ApiProperty({ example: '2025-06-07' }) @IsDateString() checkOut: string;
  @ApiProperty() @IsNumber() @Min(1) @Max(50) guests: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) adultsCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) childrenCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) infantsCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) petsCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() guestMessage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() specialRequests?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentMethodId?: string;
}
