import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** The token part of an emailed link (ACC-02, ACC-07). */
export class EmailTokenDto {
  @ApiProperty({ description: 'The token from the link in the email' })
  @IsString()
  @Length(20, 200)
  token: string;
}
