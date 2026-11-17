import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Paginated } from '../common/dto/pagination.dto.js';
import { paginate } from '../common/utils/paginate.js';
import { ProviderStatus } from '../flights/catalogue.constants.js';
import { Hotel } from '../hotels/schemas/hotel.schema.js';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service.js';
import { Itinerary } from '../itineraries/schemas/itinerary.schema.js';
import { User } from '../users/schemas/user.schema.js';
import type {
  AddFavouriteDto,
  FavouriteDto,
  ListFavouritesQueryDto,
} from './dto/favourite.dto.js';
import { Favourite, FavouriteType } from './schemas/favourite.schema.js';

const DUPLICATE_KEY = 11000;
type FavouriteRow = Favourite & { _id: Types.ObjectId };

/**
 * BON-02 (bonus): save hotels (HTL-11) and public itineraries (ITN-21) to a
 * favourites list and view it. Added by Youssef Khafagy.
 *  - only an active hotel or an itinerary that is public right now can be
 *    saved (the same visibility rule as public search, so nothing private leaks);
 *  - saving twice is harmless (unique index);
 *  - if a saved item later disappears or turns private, the entry stays but
 *    shows available: false with no details, until the user removes it.
 */
@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(Favourite.name) private readonly favourites: Model<Favourite>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly publicItineraries: PublicItinerariesService,
  ) {}

  /** POST /api/favourites */
  async add(userId: string, dto: AddFavouriteDto): Promise<FavouriteDto> {
    const targetId = new Types.ObjectId(dto.targetId);
    if (dto.targetType === FavouriteType.HOTEL) {
      if (
        !(await this.hotels.exists({
          _id: targetId,
          status: ProviderStatus.ACTIVE,
        }))
      )
        throw new NotFoundException('Hotel not found');
    } else {
      const visible = await this.publicItineraries.visibleFilter();
      if (!(await this.itineraries.exists({ _id: targetId, ...visible })))
        throw new NotFoundException('Public itinerary not found'); // never reveal private ones
    }
    const key = {
      userId: new Types.ObjectId(userId),
      targetType: dto.targetType,
      targetId,
    };
    try {
      await this.favourites.create(key);
    } catch (e) {
      if ((e as { code?: number }).code !== DUPLICATE_KEY) throw e; // already saved: fine
    }
    const row = (await this.favourites
      .findOne(key)
      .lean()
      .exec()) as FavouriteRow;
    return (await this.describe([row]))[0];
  }

  /** DELETE /api/favourites/:type/:targetId */
  async remove(
    userId: string,
    type: FavouriteType,
    targetId: string,
  ): Promise<void> {
    const res = await this.favourites
      .deleteOne({
        userId: new Types.ObjectId(userId),
        targetType: type,
        targetId: new Types.ObjectId(targetId),
      })
      .exec();
    if (res.deletedCount === 0)
      throw new NotFoundException('Not in your favourites');
  }

  /** GET /api/favourites: newest first, 10 per page (GEN-05). */
  async list(
    userId: string,
    q: ListFavouritesQueryDto,
  ): Promise<Paginated<FavouriteDto>> {
    const filter = {
      userId: new Types.ObjectId(userId),
      ...(q.type ? { targetType: q.type } : {}),
    };
    const page = await paginate(this.favourites, filter, {
      page: q.page,
      sort: { createdAt: -1, _id: -1 },
    });
    return {
      items: await this.describe(page.items as FavouriteRow[]),
      meta: page.meta,
    };
  }

  /** Adds the current details of each saved hotel or itinerary (two queries, no N+1). */
  private async describe(rows: FavouriteRow[]): Promise<FavouriteDto[]> {
    const ids = (type: FavouriteType) =>
      rows.filter((r) => r.targetType === type).map((r) => r.targetId);
    const hotelIds = ids(FavouriteType.HOTEL);
    const itineraryIds = ids(FavouriteType.ITINERARY);

    const hotels = hotelIds.length
      ? await this.hotels
          .find(
            { _id: { $in: hotelIds }, status: ProviderStatus.ACTIVE },
            { name: 1, starClass: 1, averageRating: 1, cityId: 1 },
          )
          .lean()
          .exec()
      : [];
    const itineraries = itineraryIds.length
      ? await this.itineraries
          .find(
            {
              _id: { $in: itineraryIds },
              ...(await this.publicItineraries.visibleFilter()),
            },
            { title: 1, userId: 1, countries: 1, dayCount: 1 },
          )
          .lean()
          .exec()
      : [];
    const authors = itineraries.length
      ? await this.users
          .find({ _id: { $in: itineraries.map((i) => i.userId) } }, { name: 1 })
          .lean()
          .exec()
      : [];
    const hotelOf = new Map(hotels.map((h) => [String(h._id), h]));
    const itineraryOf = new Map(itineraries.map((i) => [String(i._id), i]));
    const authorOf = new Map(authors.map((u) => [String(u._id), u.name]));

    return rows.map((r) => {
      const base = {
        id: String(r._id),
        targetType: r.targetType,
        targetId: String(r.targetId),
        savedAt: r.createdAt,
      };
      if (r.targetType === FavouriteType.HOTEL) {
        const h = hotelOf.get(String(r.targetId));
        return {
          ...base,
          name: h?.name ?? null,
          available: !!h,
          hotel: h
            ? {
                starClass: h.starClass,
                averageRating: h.averageRating ?? null,
                cityId: h.cityId,
              }
            : null,
        };
      }
      const i = itineraryOf.get(String(r.targetId));
      return {
        ...base,
        name: i?.title ?? null,
        available: !!i,
        itinerary: i
          ? {
              authorName: authorOf.get(String(i.userId)) ?? 'Deleted user',
              countries: i.countries,
              dayCount: i.dayCount,
            }
          : null,
      };
    });
  }
}
