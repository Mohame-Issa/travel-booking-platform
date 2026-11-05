import {
  ArgumentMetadata,
  HttpStatus,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { ErrorCode } from '../constants/error-codes.js';
import { ApiException } from '../exceptions/api.exception.js';

/**
 * Validates a MongoDB id in a route parameter:
 *   @Get(':id') findOne(@Param('id', ParseObjectIdPipe) id: string)
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!isValidObjectId(value) || !/^[0-9a-fA-F]{24}$/.test(value)) {
      const field = metadata.data ?? 'id';
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_ID,
        `Invalid ${field}`,
        [{ field, messages: [`${field} must be a valid id`] }],
      );
    }
    return value;
  }
}
