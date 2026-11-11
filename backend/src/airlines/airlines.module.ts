import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AIRLINE_LOGO_RESOLVER,
  PendingAirlineLogoResolver,
} from './airline-logo.interface.js';
import { AirlinesController } from './airlines.controller.js';
import { AirlinesService } from './airlines.service.js';
import { Airline, AirlineSchema } from './schemas/airline.schema.js';
import {
  AirlinePolicy,
  AirlinePolicySchema,
} from './schemas/airline-policy.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: AirlinePolicy.name, schema: AirlinePolicySchema },
    ]),
  ],
  controllers: [AirlinesController],
  providers: [
    AirlinesService,
    { provide: AIRLINE_LOGO_RESOLVER, useClass: PendingAirlineLogoResolver },
  ],
  exports: [AirlinesService, MongooseModule],
})
export class AirlinesModule {}
