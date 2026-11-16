import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { BookingGroup } from '../booking-rules.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RoomGuestsDto {
  @ApiProperty() @IsMongoId() roomId: string;
  @ApiProperty({ minimum: 0, example: 2 })
  @IsInt()
  @Min(0)
  @Max(50)
  adults: number;
  @ApiPropertyOptional({
    type: [Number],
    example: [7],
    description: 'Age of each child, 0-17 (HTL-16)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true })
  childrenAges: number[] = [];
}

export class CreateHotelBookingDto {
  @ApiProperty() @IsMongoId() hotelId: string;
  @ApiProperty({ example: '2026-12-01' }) @Matches(DATE) checkInDate: string;
  @ApiProperty({
    example: '2026-12-04',
    description: 'Exclusive (the night before is the last night)',
  })
  @Matches(DATE)
  checkOutDate: string;
  @ApiProperty({ type: [RoomGuestsDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RoomGuestsDto)
  rooms: RoomGuestsDto[];
}

export class HotelBookingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BookingGroup,
    description: 'HTL-20 grouping; all when omitted',
  })
  @IsOptional()
  @IsEnum(BookingGroup)
  group?: BookingGroup;
}

export class BookedRoomDto {
  @ApiProperty() roomId: string;
  @ApiProperty() roomNumber: string;
  @ApiProperty() type: string;
  @ApiProperty() pricePerNight: number;
  @ApiProperty() adults: number;
  @ApiProperty({ type: [Number] }) childrenAges: number[];
}

export class HotelBookingResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Issued after payment (HTL-17)',
  })
  reference: string | null;
  @ApiProperty() hotelId: string;
  @ApiProperty({ type: [BookedRoomDto] }) rooms: BookedRoomDto[];
  @ApiProperty() checkInDate: Date;
  @ApiProperty() checkOutDate: Date;
  @ApiProperty() nights: number;
  @ApiProperty() totalAmount: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({ example: 'Pending Payment' }) status: string;
  @ApiProperty({ type: Date, nullable: true }) holdExpiresAt: Date | null;
}
