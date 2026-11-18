import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UploadAirlineLogoResolver } from '../uploads/airline-logo.resolver.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AIRLINE_LOGO_RESOLVER } from './airline-logo.interface.js';
import { AirlinesController } from './airlines.controller.js';
import { AirlinesService } from './airlines.service.js';
import { Airline, AirlineSchema } from './schemas/airline.schema.js';
import {
  AirlinePolicy,
  AirlinePolicySchema,
} from './schemas/airline-policy.schema.js';

@Module({
  imports: [
    UploadsModule, // explicit, so test harnesses without AppModule still resolve the logo resolver
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: AirlinePolicy.name, schema: AirlinePolicySchema },
    ]),
  ],
  controllers: [AirlinesController],
  providers: [
    AirlinesService,
    { provide: AIRLINE_LOGO_RESOLVER, useExisting: UploadAirlineLogoResolver },
  ],
  exports: [AirlinesService, MongooseModule],
})
export class AirlinesModule {}
