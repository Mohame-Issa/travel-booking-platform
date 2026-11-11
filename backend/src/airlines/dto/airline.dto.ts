import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';
import { Optional } from '../../flights/catalogue-validation.js';

export class CreateAirlineDto {
  @ApiProperty({ example: 'Example Air' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
  @ApiProperty({ example: 'EA' })
  @IsString()
  @IsNotEmpty()
  code: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES, example: 'EGP' })
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}
export class UpdateAirlineDto extends PartialType(
  OmitType(CreateAirlineDto, ['currency'] as const),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    description:
      "Asset identifier from Hashad's image-upload service; requires AIRLINE_LOGO_RESOLVER integration",
  })
  @Optional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  logoAssetId?: string;
}
export class BaggagePolicyDto {
  @ApiProperty({ minimum: 0, exclusiveMinimum: true, example: 250 })
  @IsNumber()
  @Min(Number.MIN_VALUE)
  extraBagPrice: number;
  @ApiProperty({ minimum: 0, example: 2 })
  @IsInt()
  @Min(0)
  maxExtraBags: number;
}
export class CancellationTierDto {
  @ApiProperty({ minimum: 0, example: 7 }) @IsInt() @Min(0) daysBefore: number;
  @ApiProperty({ minimum: 0, maximum: 100, example: 80 })
  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercentage: number;
}
export class CancellationPolicyDto {
  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'Unique thresholds; highest applicable daysBefore wins; no applicable tier means 0% (FLT-09)',
  })
  @IsArray()
  @ArrayUnique((tier: CancellationTierDto | null) => tier?.daysBefore)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  tiers: CancellationTierDto[];
}
export class AirlineResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() name: string;
  @ApiProperty() code: string;
  @ApiProperty() currency: string;
  @ApiProperty() status: string;
  @ApiProperty({ type: String, nullable: true }) logoUrl: string | null;
}
export class AirlinePolicyResponseDto {
  @ApiProperty() airlineId: string;
  @ApiProperty({ type: Number, nullable: true }) extraBagPrice: number | null;
  @ApiProperty() maxExtraBags: number;
  @ApiProperty({ type: [CancellationTierDto] })
  cancellationTiers: CancellationTierDto[];
}
