import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export class AnalyticsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'First day of the period (UTC). Default: 29 days before "to".',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Last day of the period, included (UTC). Default: today.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({
    enum: ['airline', 'hotel'],
    description: 'Only airlines or only hotels',
  })
  @IsOptional()
  @IsIn(['airline', 'hotel'])
  providerType?: 'airline' | 'hotel';
}

export class AnalyticsFiguresDto {
  @ApiProperty({
    description:
      'Bookings confirmed in the period (including ones cancelled later)',
  })
  bookings: number;
  @ApiProperty({ description: 'Of those, how many are now cancelled' })
  cancelled: number;
  @ApiProperty({ description: 'Sum of their booking totals' })
  grossRevenue: number;
  @ApiProperty({
    description: 'Cancellation refunds on those bookings (pending or refunded)',
  })
  refunds: number;
  @ApiProperty({ description: 'grossRevenue - refunds' })
  netRevenue: number;
}

export class ProviderAnalyticsDto extends AnalyticsFiguresDto {
  @ApiProperty({ enum: ['airline', 'hotel'] }) providerType:
    'airline' | 'hotel';
  @ApiProperty() providerId: string;
  @ApiProperty({ example: 'Nile Air' }) name: string;
}

export class AnalyticsResponseDto {
  @ApiProperty({ example: '2026-11-01' }) from: string;
  @ApiProperty({ example: '2026-11-30' }) to: string;
  @ApiProperty({ example: 'EGP', description: 'PAY-04 platform currency' })
  currency: string;
  @ApiProperty({
    type: AnalyticsFiguresDto,
    description: 'All providers together',
  })
  totals: AnalyticsFiguresDto;
  @ApiProperty({
    type: [ProviderAnalyticsDto],
    description: 'Highest net revenue first, 10 per page',
  })
  items: ProviderAnalyticsDto[];
  @ApiProperty({
    example: { page: 1, pageSize: 10, totalItems: 3, totalPages: 1 },
  })
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
