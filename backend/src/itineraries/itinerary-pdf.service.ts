import { HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PDFDocument from 'pdfkit';
import { City } from '../seed/schemas/reference-data.schema.js';
import { BudgetsService } from './budgets.service.js';
import type { BudgetSummaryDto } from './dto/budget.dto.js';
import { ItinerariesService } from './itineraries.service.js';

/**
 * ITN-28 (bonus): export or print an itinerary as a PDF. Same approach as Omar
 * Hashem's e-ticket (pdfkit into a Buffer, returned as a StreamableFile).
 */
@Injectable()
export class ItineraryPdfService {
  constructor(
    @InjectModel(City.name) private readonly cities: Model<City>,
    private readonly itineraries: ItinerariesService,
    private readonly budgets: BudgetsService,
  ) {}

  async render(
    itineraryId: string,
    userId: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const it = await this.itineraries.getDetail(itineraryId);
    let budget: BudgetSummaryDto | null = null;
    try {
      budget = await this.budgets.summary(itineraryId, userId);
    } catch (err) {
      // Exchange rates unavailable and nothing cached: export without totals.
      if (!(err instanceof HttpException)) throw err;
    }
    const cityRows = await this.cities
      .find({ _id: { $in: it.days.map((d) => d.cityId) } }, { name: 1 })
      .lean()
      .exec();
    const cityName = new Map(cityRows.map((c) => [c._id, c.name]));
    const city = (id: string) => cityName.get(id) ?? id;

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(22).text(it.title, { align: 'center' }).moveDown(0.3);
      doc
        .fontSize(11)
        .text(
          `${it.countries.join(', ')}  |  ${it.startDate}${it.endDate ? ` to ${it.endDate}` : ''}  |  ${it.dayCount} day(s)`,
          {
            align: 'center',
          },
        )
        .moveDown();

      for (const day of it.days) {
        doc
          .fontSize(14)
          .text(`Day ${day.dayNumber} - ${day.date} - ${city(day.cityId)}`)
          .moveDown(0.2);
        doc.fontSize(10);
        if (day.notes) doc.text(day.notes).moveDown(0.2);
        for (const a of day.activities) {
          const cost = a.cost !== null ? ` (${a.cost} ${a.currency})` : '';
          doc.text(`- ${a.time ? `${a.time} ` : ''}${a.name}${cost}`);
          if (a.description) doc.text(`  ${a.description}`);
        }
        for (const b of day.budgetEntries)
          doc.text(
            `- Budget, ${b.category}: ${b.amount} ${b.currency}${b.note ? ` (${b.note})` : ''}`,
          );
        for (const t of day.transportCosts) {
          doc.text(
            `- ${t.mode}: ${city(t.fromCityId)} to ${city(t.toCityId)}, ${t.amount} ${t.currency}`,
          );
        }
        for (const l of day.linkedBookings) {
          doc.text(
            `- Booked ${l.bookingType} (${l.status}): ${l.amount} ${l.currency}`,
          );
        }
        doc.moveDown(0.6);
      }

      if (budget) {
        doc
          .fontSize(14)
          .text(`Budget (${budget.currency})`)
          .moveDown(0.2)
          .fontSize(10);
        for (const [category, amount] of Object.entries(budget.byCategory))
          doc.text(`${category}: ${amount}`);
        doc.text(`Total: ${budget.total} ${budget.currency}`);
        if (budget.rateDate)
          doc.text(
            `Exchange rates of ${budget.rateDate}${budget.ratesAreLatest ? '' : ' (cached)'}`,
          );
      }
      doc.end();
    });
    const safe =
      it.title
        .replace(/[^A-Za-z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-') || 'itinerary';
    return { pdf, filename: `${safe}.pdf` };
  }
}
