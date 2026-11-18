import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { paginate } from '../common/utils/paginate.js';
import {
  escapeRegex,
  invalid,
  validatePage,
} from '../flights/catalogue-validation.js';
import { AirportsQueryDto } from './dto/airport.dto.js';
import { Airport } from './schemas/airport.schema.js';

@Injectable()
export class AirportsService {
  constructor(
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
  ) {}
  list(query: AirportsQueryDto) {
    validatePage(query.page);
    const filter: QueryFilter<Airport> = {};
    if (query.cityId) filter.cityId = query.cityId;
    if (query.countryCode) filter.countryCode = query.countryCode;
    if (query.search) {
      const text = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: text }, { iataCode: text }];
    }
    return paginate(this.airports, filter, {
      page: query.page,
      sort: { iataCode: 1 },
    });
  }
  async get(code: string): Promise<Airport> {
    const airport = await this.airports.findById(code).lean().exec();
    if (!airport)
      invalid(
        'Airport is not in the official reference list (FLT-02)',
        'airport',
      );
    return airport;
  }
}
