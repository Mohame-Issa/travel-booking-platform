import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../common/constants/currencies.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { toIsoDate } from './itinerary-dates.js';
import { ExchangeRate } from './schemas/exchange-rate.schema.js';

/** FXRatesAPI (project description 6.5). Called from the backend only. */
const FX_URL = 'https://api.fxratesapi.com/latest';
/** All rates are stored against USD; any pair is rate[to] / rate[from]. */
const BASE = 'USD';
/** Technical: don't let a slow API hang the request. */
const TIMEOUT_MS = 5_000;

export interface RateTable {
  rates: Record<string, number>;
  /** Day the rates are for (shown to the user, ITN-18). */
  rateDate: string;
  /** false when the API failed and older cached rates are used (ITN-18). */
  isLatest: boolean;
}

/**
 * ITN-18: exchange rates are fetched at most once per day from FXRatesAPI and
 * cached in the "exchangerates" collection. If the API is unavailable, the
 * last cached rates are used. The optional FXRATES_API_KEY (backend/.env) is
 * sent as a header and never reaches the frontend.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(
    @InjectModel(ExchangeRate.name) private readonly rates: Model<ExchangeRate>,
    private readonly config: ConfigService,
  ) {}

  async getRates(now = new Date()): Promise<RateTable> {
    const today = toIsoDate(now);
    const cachedToday = await this.rates
      .findOne({ base: BASE, fetchedOn: today })
      .lean()
      .exec();
    if (cachedToday) return toTable(cachedToday, true);

    try {
      const fresh = await this.fetchLatest();
      await this.rates
        .updateOne(
          { base: BASE, fetchedOn: today },
          { $set: { rateDate: fresh.rateDate, rates: fresh.rates } },
          { upsert: true },
        )
        .exec();
      return { ...fresh, isLatest: true };
    } catch (err) {
      // ITN-18: API unavailable -> last cached rates.
      this.logger.warn(
        `FXRatesAPI unavailable (${(err as Error).message}); using cached rates`,
      );
      const last = await this.rates
        .findOne({ base: BASE })
        .sort({ fetchedOn: -1 })
        .lean()
        .exec();
      if (!last) {
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.EXCHANGE_RATES_UNAVAILABLE,
          'Exchange rates are unavailable right now and none are cached yet',
        );
      }
      return toTable(last, false);
    }
  }

  /** One HTTP call to FXRatesAPI. Throws on any problem (network, bad data). */
  async fetchLatest(): Promise<{
    rates: Record<string, number>;
    rateDate: string;
  }> {
    const url = `${FX_URL}?base=${BASE}&currencies=${SUPPORTED_CURRENCIES.join(',')}`;
    const key = this.config.get<string>('FXRATES_API_KEY');
    const res = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      success?: boolean;
      date?: string;
      rates?: Record<string, unknown>;
    };
    const rates: Record<string, number> = {};
    for (const code of SUPPORTED_CURRENCIES) {
      const value = body.rates?.[code];
      if (typeof value !== 'number' || !(value > 0))
        throw new Error(`missing rate for ${code}`);
      rates[code] = value;
    }
    if (body.success !== true || typeof body.date !== 'string')
      throw new Error('unexpected response');
    return { rates, rateDate: body.date.slice(0, 10) };
  }
}

/** amount in `from` -> amount in `to`. */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (from === to) return amount;
  return (amount * rates[to]) / rates[from];
}

function toTable(
  doc: { rates: unknown; rateDate: string },
  isLatest: boolean,
): RateTable {
  // lean() returns the Map as a plain object.
  const rates =
    doc.rates instanceof Map
      ? Object.fromEntries(doc.rates as Map<string, number>)
      : (doc.rates as Record<string, number>);
  return { rates, rateDate: doc.rateDate, isLatest };
}
