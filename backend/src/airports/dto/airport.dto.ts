import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { Optional } from '../../flights/catalogue-validation.js';

export class AirportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Airport name or IATA code' })
  @Optional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ example: 'cairo' })
  @Optional()
  @IsString()
  @MaxLength(100)
  cityId?: string;
  @ApiPropertyOptional({ example: 'EG' })
  @Optional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
}
export class AirportResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() iataCode: string;
  @ApiProperty() name: string;
  @ApiProperty() cityId: string;
  @ApiProperty() countryCode: string;
  @ApiProperty() timeZone: string;
}
