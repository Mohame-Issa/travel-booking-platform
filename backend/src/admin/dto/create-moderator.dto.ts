
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';
import { ProviderType } from '../../common/constants/roles.js';
import { IsValidPassword } from '../../auth/password.rules.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateModeratorDto {
  @ApiProperty({ example: 'John Smith' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email: string;

  @IsValidPassword()
  password: string;

  @ApiProperty({
    enum: ProviderType,
    example: ProviderType.AIRLINE,
    description: 'The provider type assigned to this moderator',
  })
  @IsEnum(ProviderType)
  providerType: ProviderType;

  @ApiProperty({
    example: '6730f1c2a1b2c3d4e5f60718',
    description: 'MongoDB ID of the airline or hotel',
  })
  @Transform(trim)
  @IsMongoId()
  providerId: string;
}
