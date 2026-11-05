import type {
  Model,
  PopulateOptions,
  ProjectionType,
  QueryFilter,
  SortOrder,
} from 'mongoose';
import { PAGE_SIZE } from '../constants/pagination.js';
import type { Paginated } from '../dto/pagination.dto.js';

export interface PaginateOptions<T> {
  page?: number;
  sort?: Record<string, SortOrder>;
  projection?: ProjectionType<T>;
  populate?: PopulateOptions | PopulateOptions[] | string;
}

/**
 * Runs a paginated find with page size 10 (GEN-05).
 *
 *   return paginate(this.hotelModel, { status: 'active' }, { page: query.page, sort: { price: 1 } });
 *
 * Always pass a `sort`, otherwise MongoDB does not guarantee a stable order
 * across pages. `_id` is added as a tie-breaker automatically.
 */
export async function paginate<T>(
  model: Model<T>,
  filter: QueryFilter<T>,
  options: PaginateOptions<T> = {},
): Promise<Paginated<T>> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const sort = { ...(options.sort ?? { createdAt: -1 }), _id: 1 as SortOrder };

  let query = model
    .find(filter, options.projection)
    .sort(sort)
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE);
  if (options.populate) {
    query = query.populate(options.populate as PopulateOptions);
  }

  const [items, totalItems] = await Promise.all([
    query.lean<T[]>().exec(),
    model.countDocuments(filter).exec(),
  ]);

  return {
    items,
    meta: {
      page,
      pageSize: PAGE_SIZE,
      totalItems,
      totalPages: Math.ceil(totalItems / PAGE_SIZE),
    },
  };
}

/** Paginates an array that is already in memory (e.g. results from an external API). */
export function paginateArray<T>(all: T[], page = 1): Paginated<T> {
  const p = Math.max(1, Math.floor(page));
  return {
    items: all.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE),
    meta: {
      page: p,
      pageSize: PAGE_SIZE,
      totalItems: all.length,
      totalPages: Math.ceil(all.length / PAGE_SIZE),
    },
  };
}
