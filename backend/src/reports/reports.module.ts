import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlogModule } from '../blog/blog.module.js';
import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import {
  AdminModerationController,
  ReportsController,
} from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { Report, ReportSchema } from './schemas/report.schema.js';

/**
 * Reports (GEN-09) and admin moderation (GEN-10). Taken over from Omar
 * Rashed's part. Reuses the itinerary and review modules' own delete logic.
 */
@Module({
  imports: [
    BlogModule,
    ItinerariesModule,
    ReviewsModule,
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
  ],
  controllers: [ReportsController, AdminModerationController],
  providers: [ReportsService],
})
export class ReportsModule {}
