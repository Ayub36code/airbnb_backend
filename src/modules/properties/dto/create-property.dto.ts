// create-property.dto.ts
import {
  IsString, IsNumber, IsBoolean, IsOptional, IsEnum,
  Min, Max, IsArray, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyType, CancellationPolicy } from '@prisma/client';

export class CreatePropertyDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(100) title: string;
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(2000) description: string;
  @ApiProperty({ enum: PropertyType }) @IsEnum(PropertyType) type: PropertyType;
  @ApiProperty() @IsString() address: string;
  @ApiProperty() @IsString() city: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
  @ApiProperty() @IsString() country: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude: number;
  @ApiProperty() @IsNumber() @Min(1) @Max(50) maxGuests: number;
  @ApiProperty() @IsNumber() @Min(0) bedrooms: number;
  @ApiProperty() @IsNumber() @Min(1) beds: number;
  @ApiProperty() @IsNumber() @Min(0.5) bathrooms: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() squareMeters?: number;
  @ApiProperty() @IsNumber() @Min(1) pricePerNight: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) cleaningFee?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) securityDeposit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(50) weeklyDiscount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(50) monthlyDiscount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) minNights?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() maxNights?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() instantBook?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() petsAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() smokingAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() eventsAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() checkInTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() checkOutTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() houseRules?: string;
  @ApiPropertyOptional({ enum: CancellationPolicy }) @IsOptional() @IsEnum(CancellationPolicy) cancellationPolicy?: CancellationPolicy;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() tags?: string[];
}
