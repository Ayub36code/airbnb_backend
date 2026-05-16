import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() preferredLanguage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() preferredCurrency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() profile?: {
    address?: string;
    city?: string;
    country?: string;
    postalCode?: string;
    emergencyContact?: Record<string, any>;
    socialLinks?: Record<string, string>;
  };
}
