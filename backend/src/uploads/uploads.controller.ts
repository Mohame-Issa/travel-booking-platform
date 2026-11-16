import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { CurrentUser, Public } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ImageTooLargeInterceptor } from './image-too-large.interceptor.js';
import { MAX_IMAGE_BYTES } from './image-type.js';
import { type IncomingImage, UploadsService } from './uploads.service.js';

class UploadResponseDto {
  @ApiProperty({
    description: 'Asset id to pass to the owning endpoint, e.g. logoAssetId',
  })
  id: string;
  @ApiProperty({ example: '/api/uploads/files/3f2c...png' }) url: string;
  @ApiProperty({ example: 'image/png' }) mimeType: string;
  @ApiProperty({ example: 52311 }) size: number;
}

@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @ApiCookieAuth()
  // memory storage; multer stops reading past the GEN-08 limit and answers 413
  @UseInterceptors(
    ImageTooLargeInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  @ApiOperation({
    summary: 'Upload one image (GEN-08)',
    description:
      'JPG or PNG (checked by content), up to 5 MB. Returns an asset id; attach it through the owning endpoint ' +
      '(e.g. PATCH /api/airlines/:id with logoAssetId). Limits per owner: 5 per hotel, post or activity; 1 logo per airline.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: UploadResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED (no file)',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_REQUIRED or SESSION_EXPIRED',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'IMAGE_TOO_LARGE (over 5 MB)',
  })
  @ApiUnsupportedMediaTypeResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_IMAGE_TYPE',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'IMAGE_LIMIT_REACHED (too many unused uploads; attach or remove some first)',
  })
  upload(
    @UploadedFile() file: IncomingImage | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.uploads.store(file, userId);
  }

  @Public()
  @Get('files/:name')
  // never let a polyglot image be sniffed or run as HTML/script
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @ApiOperation({ summary: 'Serve a stored image by its URL (GEN-08)' })
  @ApiOkResponse({ description: 'The image bytes' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'ASSET_NOT_FOUND',
  })
  file(@Param('name') name: string) {
    return this.uploads.openFile(name);
  }
}
