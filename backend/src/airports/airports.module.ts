import { Module } from '@nestjs/common';
import { ReferenceDataModule } from '../seed/reference-data.module.js';
import { AirportsController } from './airports.controller.js';
import { AirportsService } from './airports.service.js';

@Module({
  imports: [ReferenceDataModule],
  controllers: [AirportsController],
  providers: [AirportsService],
  exports: [AirportsService, ReferenceDataModule],
})
export class AirportsModule {}
