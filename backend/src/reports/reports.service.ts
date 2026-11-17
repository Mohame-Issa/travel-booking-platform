import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BlogService } from '../blog/blog.service.js';
import { Comment } from '../blog/schemas/comment.schema.js';
import { Post, PostStatus } from '../blog/schemas/post.schema.js';
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

/** Model name of each content type, for the audit log. */
const MODEL_NAME: Record<ReportTargetType, string> = {
  [ReportTargetType.POST]: 'Post',
  [ReportTargetType.COMMENT]: 'Comment',
  [ReportTargetType.REVIEW]: 'Review',
  [ReportTargetType.ITINERARY]: 'Itinerary',
};

/**
 * Reports (GEN-09) and admin moderation (GEN-10). Taken over from Omar
 * Rashed's part. Hidden content keeps existing for its author and admins but
 * disappears from public lists; deleted content is gone. Deletes reuse each
 * owner module's own delete logic. Every admin action is written to Mohamed
 * Hashad's audit log (GEN-07).
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly itinerariesService: ItinerariesService,
    private readonly reviewsService: ReviewsService,
    private readonly blog: BlogService,
  ) {}

  /** POST /api/reports (GEN-09): with a reason, at most once per item per user. */
  async create(reporterId: string, dto: CreateReportDto): Promise<ReportDto> {
    if (!(await this.isVisible(dto.targetType, dto.targetId))) {
      throw new NotFoundException(`${dto.targetType} not found`);
    }
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
      await this.setHidden(report.targetType, targetId, true, adminId);
    } else {
      await this.deleteContent(report.targetType, targetId, adminId);
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
    const doc = await this.updateHidden(type, id, set);
    if (!doc) throw new NotFoundException(`${type} not found`);
    // A hidden review stops counting in the hotel rating (HTL-23) ...
    if (type === ReportTargetType.REVIEW)
      await this.reviewsService.recalculate((doc as Review).hotelId);
    // ... and a hidden comment in the post's comment count and score (BLG-09).
    if (type === ReportTargetType.COMMENT)
      await this.blog.recount((doc as Comment).postId);
    if (hidden)
      await this.closeOpenFor(type, id, ReportStatus.CONTENT_HIDDEN, adminId);
    await this.audit.record({
      actorId: adminId,
      action: `${type}.${hidden ? 'hidden' : 'unhidden'}`,
      targetType: MODEL_NAME[type],
      targetId: id,
    });
  }

  /** DELETE /api/admin/content/:type/:id (GEN-10), using each module's own delete. */
  async deleteContent(
    type: ReportTargetType,
    id: string,
    adminId: string,
  ): Promise<void> {
    if (type === ReportTargetType.ITINERARY)
      await this.itinerariesService.remove(id);
    else if (type === ReportTargetType.REVIEW)
      await this.reviewsService.remove(id);
    else if (type === ReportTargetType.POST) await this.blog.remove(id);
    else await this.blog.removeComment(id);
    await this.closeOpenFor(type, id, ReportStatus.CONTENT_DELETED, adminId);
    await this.audit.record({
      actorId: adminId,
      action: `${type}.deleted`,
      targetType: MODEL_NAME[type],
      targetId: id,
    });
  }

  // ---------------------------------------------------------------- internals

  /** GEN-09: only content the reporter can see can be reported. */
  private async isVisible(
    type: ReportTargetType,
    id: string,
  ): Promise<boolean> {
    switch (type) {
      case ReportTargetType.ITINERARY:
        return !!(await this.itineraries.exists({
          _id: id,
          visibility: ItineraryVisibility.PUBLIC,
          hiddenAt: null,
        }));
      case ReportTargetType.REVIEW:
        return !!(await this.reviews.exists({ _id: id, hiddenAt: null }));
      case ReportTargetType.POST:
        return !!(await this.posts.exists({
          _id: id,
          status: PostStatus.PUBLISHED,
          hiddenAt: null,
        }));
      default: {
        const c = await this.comments
          .findOne({ _id: id, hiddenAt: null }, { postId: 1 })
          .lean()
          .exec();
        return (
          !!c &&
          !!(await this.posts.exists({
            _id: c.postId,
            status: PostStatus.PUBLISHED,
            hiddenAt: null,
          }))
        );
      }
    }
  }

  private updateHidden(
    type: ReportTargetType,
    id: string,
    set: object,
  ): Promise<unknown> {
    const opts = { new: true } as const;
    switch (type) {
      case ReportTargetType.ITINERARY:
        return this.itineraries.findByIdAndUpdate(id, set, opts).lean().exec();
      case ReportTargetType.REVIEW:
        return this.reviews.findByIdAndUpdate(id, set, opts).lean().exec();
      case ReportTargetType.POST:
        return this.posts.findByIdAndUpdate(id, set, opts).lean().exec();
      default:
        return this.comments.findByIdAndUpdate(id, set, opts).lean().exec();
    }
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
    const row = await this.preview(type, id);
    if (!row)
      return {
        type,
        id: id.toString(),
        exists: false,
        hidden: false,
        preview: null,
        authorId: null,
      };
    return { type, id: id.toString(), exists: true, ...row };
  }

  private async preview(
    type: ReportTargetType,
    id: Types.ObjectId,
  ): Promise<{ hidden: boolean; preview: string; authorId: string } | null> {
    switch (type) {
      case ReportTargetType.ITINERARY: {
        const d = await this.itineraries
          .findById(id, { title: 1, userId: 1, hiddenAt: 1 })
          .lean()
          .exec();
        return (
          d && {
            hidden: d.hiddenAt !== null,
            preview: d.title,
            authorId: d.userId.toString(),
          }
        );
      }
      case ReportTargetType.REVIEW: {
        const d = await this.reviews
          .findById(id, { comment: 1, rating: 1, userId: 1, hiddenAt: 1 })
          .lean()
          .exec();
        return (
          d && {
            hidden: d.hiddenAt !== null,
            preview: `${d.rating}/5 ${d.comment}`.trim(),
            authorId: d.userId.toString(),
          }
        );
      }
      case ReportTargetType.POST: {
        const d = await this.posts
          .findById(id, { title: 1, authorId: 1, hiddenAt: 1 })
          .lean()
          .exec();
        return (
          d && {
            hidden: d.hiddenAt !== null,
            preview: d.title,
            authorId: d.authorId.toString(),
          }
        );
      }
      default: {
        const d = await this.comments
          .findById(id, { body: 1, authorId: 1, hiddenAt: 1 })
          .lean()
          .exec();
        return (
          d && {
            hidden: d.hiddenAt !== null,
            preview: d.body,
            authorId: d.authorId.toString(),
          }
        );
      }
    }
  }
}
