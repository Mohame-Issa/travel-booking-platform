import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UploadAirlineLogoResolver } from './airline-logo.resolver.js';
import { Upload, UploadSchema } from './schemas/upload.schema.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

/** GEN-08. Global so owner modules (hotels, posts, activities) can inject UploadsService. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Upload.name, schema: UploadSchema }]),
  ],
  controllers: [UploadsController],
  providers: [UploadsService, UploadAirlineLogoResolver],
  exports: [UploadsService, UploadAirlineLogoResolver],
})
export class UploadsModule {}
