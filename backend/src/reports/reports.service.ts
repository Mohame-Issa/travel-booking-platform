import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import type { Paginated } from '../common/dto/pagination.dto.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  AUDIT_SERVICE,
  type AuditService,
} from '../common/interfaces/index.js';
import { paginate } from '../common/utils/paginate.js';
import { ItinerariesService } from '../itineraries/itineraries.service.js';
import {
  Itinerary,
  ItineraryVisibility,
} from '../itineraries/schemas/itinerary.schema.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { Review } from '../reviews/schemas/review.schema.js';
import type {
  CreateReportDto,
  ReportAction,
  ReportDto,
  ReportTargetDto,
} from './dto/report.dto.js';
import {
  Report,
  ReportStatus,
  ReportTargetType,
} from './schemas/report.schema.js';

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;

type ReportRow = Report & { _id: Types.ObjectId };

/**
 * Reports (GEN-09) and admin moderation (GEN-10). Taken over from Omar
 * Rashed's part. Hidden content keeps existing for its author and admins but
 * disappears from public search / review lists; deleted content is gone.
 * Every admin action is written to Mohamed Hashad's audit log (GEN-07).
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly itinerariesService: ItinerariesService,
    private readonly reviewsService: ReviewsService,
  ) {}

  /** POST /api/reports (GEN-09): with a reason, at most once per item per user. */
  async create(reporterId: string, dto: CreateReportDto): Promise<ReportDto> {
    // You can only report what you can see: a public itinerary or a visible review.
    const visible =
      dto.targetType === ReportTargetType.ITINERARY
        ? await this.itineraries.exists({
            _id: dto.targetId,
            visibility: ItineraryVisibility.PUBLIC,
            hiddenAt: null,
          })
        : await this.reviews.exists({ _id: dto.targetId, hiddenAt: null });
    if (!visible) throw new NotFoundException(`${dto.targetType} not found`);

    try {
      const report = await this.reports.create({
        reporterId: new Types.ObjectId(reporterId),
        targetType: dto.targetType,
        targetId: new Types.ObjectId(dto.targetId),
        reason: dto.reason,
      });
      return this.toDto(report.toObject() as ReportRow);
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.ALREADY_REPORTED,
          'You already reported this',
        );
      }
      throw err;
    }
  }

  /** GET /api/admin/reports (GEN-10): open reports by default, oldest first. */
  async list(
    status: ReportStatus,
    page: number,
  ): Promise<Paginated<ReportDto>> {
    const result = await paginate(
      this.reports,
      { status },
      { page, sort: { createdAt: 1 } },
    );
    return {
      items: await Promise.all(
        result.items.map((r) => this.toDto(r as ReportRow)),
      ),
      meta: result.meta,
    };
  }

  /** PATCH /api/admin/reports/:id (GEN-10): dismiss, hide the content or delete it. */
  async resolve(
    id: string,
    action: ReportAction,
    adminId: string,
  ): Promise<ReportDto> {
    const report = await this.reports.findById(id).lean().exec();
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.OPEN) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.REPORT_ALREADY_RESOLVED,
        `This report is already ${report.status}`,
      );
    }
    const type = report.targetType;
    const targetId = report.targetId.toString();

    if (action === 'dismiss') {
      await this.close({ _id: report._id }, ReportStatus.DISMISSED, adminId);
      await this.audit.record({
        actorId: adminId,
        action: 'report.dismissed',
        targetType: 'Report',
        targetId: id,
      });
    } else if (action === 'hide') {
      await this.setHidden(type, targetId, true, adminId);
    } else {
      await this.deleteContent(type, targetId, adminId);
    }
    return this.toDto(
      (await this.reports.findById(id).lean().exec()) as ReportRow,
    );
  }

  /**
   * PATCH /api/admin/content/:type/:id (GEN-10): hide or show again directly.
   * Hiding also resolves every open report on that content.
   */
  async setHidden(
    type: ReportTargetType,
    id: string,
    hidden: boolean,
    adminId: string,
  ): Promise<void> {
    const set = { $set: { hiddenAt: hidden ? new Date() : null } };
    const doc =
      type === ReportTargetType.ITINERARY
        ? await this.itineraries
            .findByIdAndUpdate(id, set, { new: true })
            .lean()
            .exec()
        : await this.reviews
            .findByIdAndUpdate(id, set, { new: true })
            .lean()
            .exec();
    if (!doc) throw new NotFoundException(`${type} not found`);
    // A hidden review no longer counts in the hotel rating (and counts again when shown).
    if (type === ReportTargetType.REVIEW)
      await this.reviewsService.recalculate((doc as Review).hotelId);
    if (hidden)
      await this.closeOpenFor(type, id, ReportStatus.CONTENT_HIDDEN, adminId);
    await this.audit.record({
      actorId: adminId,
      action: `${type}.${hidden ? 'hidden' : 'unhidden'}`,
      targetType: type === ReportTargetType.REVIEW ? 'Review' : 'Itinerary',
      targetId: id,
    });
  }

  /**
   * DELETE /api/admin/content/:type/:id (GEN-10). Uses the owners' own delete
   * logic, so an itinerary goes with its days/activities/budgets and a
   * review's hotel rating is recalculated.
   */
  async deleteContent(
    type: ReportTargetType,
    id: string,
    adminId: string,
  ): Promise<void> {
    if (type === ReportTargetType.ITINERARY)
      await this.itinerariesService.remove(id);
    else await this.reviewsService.remove(id);
    await this.closeOpenFor(type, id, ReportStatus.CONTENT_DELETED, adminId);
    await this.audit.record({
      actorId: adminId,
      action: `${type}.deleted`,
      targetType: type === ReportTargetType.REVIEW ? 'Review' : 'Itinerary',
      targetId: id,
    });
  }

  private closeOpenFor(
    type: ReportTargetType,
    id: string,
    status: ReportStatus,
    adminId: string,
  ) {
    return this.close(
      {
        targetType: type,
        targetId: new Types.ObjectId(id),
        status: ReportStatus.OPEN,
      },
      status,
      adminId,
    );
  }

  private async close(
    filter: Record<string, unknown>,
    status: ReportStatus,
    adminId: string,
  ) {
    await this.reports
      .updateMany(filter, {
        $set: {
          status,
          resolvedBy: new Types.ObjectId(adminId),
          resolvedAt: new Date(),
        },
      })
      .exec();
  }

  private async toDto(r: ReportRow): Promise<ReportDto> {
    return {
      id: r._id.toString(),
      reporterId: r.reporterId.toString(),
      reason: r.reason,
      status: r.status,
      target: await this.describe(r.targetType, r.targetId),
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    };
  }

  /** What the admin needs to judge the report, without opening the content. */
  private async describe(
    type: ReportTargetType,
    id: Types.ObjectId,
  ): Promise<ReportTargetDto> {
    const doc =
      type === ReportTargetType.ITINERARY
        ? await this.itineraries
            .findById(id, { title: 1, userId: 1, hiddenAt: 1 })
            .lean()
            .exec()
        : await this.reviews
            .findById(id, { comment: 1, rating: 1, userId: 1, hiddenAt: 1 })
            .lean()
            .exec();
    if (!doc)
      return {
        type,
        id: id.toString(),
        exists: false,
        hidden: false,
        preview: null,
        authorId: null,
      };
    const preview =
      type === ReportTargetType.ITINERARY
        ? (doc as Itinerary).title
        : `${(doc as Review).rating}/5 ${(doc as Review).comment}`.trim();
    return {
      type,
      id: id.toString(),
      exists: true,
      hidden: doc.hiddenAt !== null,
      preview,
      authorId: doc.userId.toString(),
    };
  }
}
