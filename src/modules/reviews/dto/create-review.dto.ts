import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty() @IsString() bookingId: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsNumber() @Min(1) @Max(5) overallRating: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsNumber() @Min(1) @Max(5) cleanlinessRating?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsNumber() @Min(1) @Max(5) accuracyRating?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsNumber() @Min(1) @Max(5) locationRating?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsNumber() @Min(1) @Max(5) valueRating?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsNumber() @Min(1) @Max(5) communicationRating?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsNumber() @Min(1) @Max(5) checkinRating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() comment?: string;
}
