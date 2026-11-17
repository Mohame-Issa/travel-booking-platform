import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter, type SortOrder, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { UserStatus } from '../common/constants/roles.js';
import type { Paginated } from '../common/dto/pagination.dto.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { paginate } from '../common/utils/paginate.js';
import { toSummary as toItinerarySummary } from '../itineraries/itineraries.service.js';
import {
  Itinerary,
  ItineraryVisibility,
} from '../itineraries/schemas/itinerary.schema.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { User } from '../users/schemas/user.schema.js';
import type {
  AuthorPageDto,
  CommentDto,
  CreatePostDto,
  LikeStateDto,
  ListPostsQueryDto,
  PostDetailDto,
  PostSummaryDto,
  UpdatePostDto,
} from './dto/blog.dto.js';
import { Comment } from './schemas/comment.schema.js';
import { Like } from './schemas/like.schema.js';
import { Post, type PostDocument, PostStatus } from './schemas/post.schema.js';

const DUPLICATE_KEY = 11000;
/** ACC-12 */
const DELETED_USER = 'Deleted user';
/** BLG-09 "excerpt": presentation length, not a business rule. */
const EXCERPT_LENGTH = 200;

type PostRow = Post & { _id: Types.ObjectId };
type CommentRow = Comment & { _id: Types.ObjectId };
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Blog (BLG-01..BLG-12). Dropped from the mandatory scope for this team (TA
 * email, 16 November); built as a bonus. Taken over from Omar Rashed's part.
 *
 * Public = published, not hidden by an admin (GEN-10) and the author is not
 * deactivated (ACC-12). likeCount, commentCount and score (BLG-09: likes +
 * comments) are recounted from the real documents after every change.
 */
@Injectable()
export class BlogService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    private readonly uploads: UploadsService,
  ) {}

  // -------------------------------------------------------------------- posts

  /** POST /api/posts (BLG-01): draft by default, or published straight away. */
  async create(authorId: string, dto: CreatePostDto): Promise<PostDetailDto> {
    const status = dto.status ?? PostStatus.DRAFT;
    const post = await this.posts.create({
      authorId: new Types.ObjectId(authorId),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status,
      publishedAt: status === PostStatus.PUBLISHED ? new Date() : null,
    });
    return this.detail(post.toObject() as PostRow);
  }

  /** PATCH /api/posts/:id (BLG-04, BLG-08). Owner checked by @CheckOwnership. */
  async update(id: string, dto: UpdatePostDto): Promise<PostDetailDto> {
    const post = await this.findPost(id);
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.body !== undefined) post.body = dto.body;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.status !== undefined) {
      post.status = dto.status;
      // The date shown is the first publication date.
      if (dto.status === PostStatus.PUBLISHED && !post.publishedAt)
        post.publishedAt = new Date();
    }
    await post.save();
    return this.detail(post.toObject() as PostRow);
  }

  /** DELETE /api/posts/:id (BLG-04): with its comments and likes; images freed. */
  async remove(id: string): Promise<void> {
    const post = await this.posts.findByIdAndDelete(id).exec();
    if (!post) throw new NotFoundException('Post not found');
    await this.comments.deleteMany({ postId: post._id }).exec();
    await this.likes.deleteMany({ postId: post._id }).exec();
    await this.uploads.detachOwner({ type: 'post', id });
  }

  /** GET /api/posts (BLG-02, BLG-09): published posts, filter by tag, keyword search. */
  async listPublished(
    q: ListPostsQueryDto,
  ): Promise<Paginated<PostSummaryDto>> {
    const and: QueryFilter<Post>[] = [await this.visibleFilter()];
    if (q.tag) and.push({ tags: q.tag });
    let sort: Record<string, SortOrder> = { publishedAt: -1 };
    if (q.q) {
      // BLG-09: keyword in title, tags or author name; ordered by likes + comments.
      const re = new RegExp(escapeRegex(q.q), 'i');
      const authors = await this.users
        .find({ name: re })
        .distinct('_id')
        .exec();
      and.push({
        $or: [{ title: re }, { tags: re }, { authorId: { $in: authors } }],
      });
      sort = { score: -1, publishedAt: -1 };
    }
    return this.page({ $and: and }, q.page, sort);
  }

  /** GET /api/tags/:tag/posts (BLG-08): clickable tags. */
  async byTag(tag: string, page: number): Promise<Paginated<PostSummaryDto>> {
    return this.page(
      {
        $and: [await this.visibleFilter(), { tags: tag.trim().toLowerCase() }],
      },
      page,
      {
        publishedAt: -1,
      },
    );
  }

  /** GET /api/posts/mine (BLG-03): my posts including drafts, last edited first. */
  async listMine(
    authorId: string,
    page: number,
  ): Promise<Paginated<PostSummaryDto>> {
    return this.page({ authorId: new Types.ObjectId(authorId) }, page, {
      updatedAt: -1,
    });
  }

  /** GET /api/posts/:id (BLG-02): the public post page. */
  async getPublic(id: string): Promise<PostDetailDto> {
    return this.detail(await this.findVisible(id), false);
  }

  /** GET /api/posts/mine/:id: my own post in any state (draft, hidden). */
  async getMine(id: string): Promise<PostDetailDto> {
    return this.detail((await this.findPost(id)).toObject() as PostRow);
  }

  // ----------------------------------------------------------------- comments

  /** GET /api/posts/:id/comments (BLG-05): chronological, 10 per page. */
  async listComments(postId: string, page: number) {
    await this.findVisible(postId);
    return this.commentPage(postId, page);
  }

  /** POST /api/posts/:id/comments (BLG-05): only on published posts. */
  async addComment(
    postId: string,
    authorId: string,
    body: string,
  ): Promise<CommentDto> {
    const post = await this.findVisible(postId);
    const comment = await this.comments.create({
      postId: post._id,
      authorId: new Types.ObjectId(authorId),
      body,
    });
    await this.recount(post._id);
    return (await this.toComments([comment.toObject() as CommentRow]))[0];
  }

  /** PATCH /api/comments/:id (BLG-07). Owner checked by @CheckOwnership. */
  async updateComment(id: string, body: string): Promise<CommentDto> {
    const comment = await this.comments
      .findByIdAndUpdate(
        id,
        { $set: { body } },
        { new: true, runValidators: true },
      )
      .lean()
      .exec();
    if (!comment) throw new NotFoundException('Comment not found');
    return (await this.toComments([comment as CommentRow]))[0];
  }

  /** DELETE /api/comments/:id (BLG-07); also used by admin moderation (GEN-10). */
  async removeComment(id: string): Promise<void> {
    const comment = await this.comments.findByIdAndDelete(id).lean().exec();
    if (!comment) throw new NotFoundException('Comment not found');
    await this.recount(comment.postId);
  }

  // -------------------------------------------------------------------- likes

  /** POST /api/posts/:id/like (BLG-06): once per user; liking again changes nothing. */
  async like(postId: string, userId: string): Promise<LikeStateDto> {
    const post = await this.findVisible(postId);
    try {
      await this.likes.create({
        postId: post._id,
        userId: new Types.ObjectId(userId),
      });
    } catch (err) {
      if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err; // already liked
    }
    return { liked: true, likeCount: await this.recount(post._id) };
  }

  /** DELETE /api/posts/:id/like (BLG-06). */
  async unlike(postId: string, userId: string): Promise<LikeStateDto> {
    const post = await this.findVisible(postId);
    await this.likes
      .deleteOne({ postId: post._id, userId: new Types.ObjectId(userId) })
      .exec();
    return { liked: false, likeCount: await this.recount(post._id) };
  }

  // ------------------------------------------------------------------- images

  /** POST /api/posts/:id/images (BLG-10, GEN-08: JPG/PNG, 5 MB, max 5). */
  async attachImage(
    id: string,
    userId: string,
    imageId: string,
  ): Promise<PostDetailDto> {
    const post = await this.findPost(id);
    const url = await this.uploads.attach(imageId, userId, {
      type: 'post',
      id,
    });
    const updated = await this.posts
      .findOneAndUpdate(
        {
          _id: post._id,
          'images.imageId': { $ne: new Types.ObjectId(imageId) },
        },
        { $push: { images: { imageId: new Types.ObjectId(imageId), url } } },
        { new: true },
      )
      .lean()
      .exec();
    return this.detail((updated ?? post.toObject()) as PostRow);
  }

  /** DELETE /api/posts/:id/images/:imageId (BLG-10). */
  async detachImage(id: string, imageId: string): Promise<PostDetailDto> {
    const post = await this.findPost(id);
    if (!post.images.some((i) => i.imageId.toString() === imageId)) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.ASSET_NOT_FOUND,
        'Image not found on this post',
      );
    }
    await this.uploads.detach(imageId, { type: 'post', id });
    const updated = await this.posts
      .findByIdAndUpdate(
        id,
        { $pull: { images: { imageId: new Types.ObjectId(imageId) } } },
        { new: true },
      )
      .lean()
      .exec();
    return this.detail(updated as PostRow);
  }

  // ---------------------------------------------------------------- BLG-13

  /**
   * PATCH /api/posts/:id/itinerary (BLG-13, bonus): attach one of MY
   * itineraries to my post, or detach it with null. Post ownership is
   * checked by @CheckOwnership; itinerary ownership here.
   */
  async setItinerary(
    id: string,
    userId: string,
    itineraryId: string | null,
  ): Promise<PostDetailDto> {
    if (itineraryId !== null) {
      const itinerary = await this.itineraries
        .findById(itineraryId, { userId: 1 })
        .lean()
        .exec();
      if (!itinerary) throw new NotFoundException('Itinerary not found');
      if (itinerary.userId.toString() !== userId) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          ErrorCode.NOT_RESOURCE_OWNER,
          'You can only attach your own itinerary',
        );
      }
    }
    const post = await this.posts
      .findByIdAndUpdate(
        id,
        {
          $set: {
            itineraryId: itineraryId ? new Types.ObjectId(itineraryId) : null,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!post) throw new NotFoundException('Post not found');
    return this.detail(post as PostRow);
  }

  private async attachedItinerary(
    p: PostRow,
    author: { id: string; name: string },
    forAuthor: boolean,
  ) {
    if (!p.itineraryId) return null;
    const filter = forAuthor
      ? { _id: p.itineraryId }
      : {
          _id: p.itineraryId,
          visibility: ItineraryVisibility.PUBLIC,
          hiddenAt: null,
        };
    const itinerary = await this.itineraries.findOne(filter).lean().exec();
    // Deleted, private or hidden: readers see no itinerary, never a private one.
    if (!itinerary) return null;
    return Object.assign(
      toItinerarySummary(itinerary as Itinerary & { _id: Types.ObjectId }),
      { author },
    );
  }

  // -------------------------------------------------------------- author page

  /** GET /api/authors/:id (BLG-12): name, join date, published posts, public itineraries. */
  async authorPage(
    id: string,
    postsPage: number,
    itinerariesPage: number,
  ): Promise<AuthorPageDto> {
    const author = await this.users
      .findById(id, { name: 1, status: 1, createdAt: 1 })
      .lean()
      .exec();
    // ACC-12: a deactivated user's posts and public itineraries are hidden.
    if (!author || author.status === UserStatus.DEACTIVATED)
      throw new NotFoundException('Author not found');
    const authorId = new Types.ObjectId(id);

    const posts = await this.page(
      { authorId, status: PostStatus.PUBLISHED, hiddenAt: null },
      postsPage,
      { publishedAt: -1 },
    );
    const its = await paginate(
      this.itineraries,
      {
        userId: authorId,
        visibility: ItineraryVisibility.PUBLIC,
        hiddenAt: null,
      },
      { page: itinerariesPage, sort: { updatedAt: -1 } },
    );
    return {
      id,
      name: author.name,
      joinedAt: (author as { createdAt: Date }).createdAt,
      posts,
      itineraries: {
        items: its.items.map((i) =>
          Object.assign(
            toItinerarySummary(i as Itinerary & { _id: Types.ObjectId }),
            {
              author: { id, name: author.name },
            },
          ),
        ),
        meta: its.meta,
      },
    };
  }

  // ---------------------------------------------------------------- internals

  /**
   * Recounts likes and visible comments from the real documents and stores
   * likeCount, commentCount and score (BLG-09). Returns the like count.
   * Exported for moderation: hiding a comment changes the counts.
   */
  async recount(postId: Types.ObjectId | string): Promise<number> {
    const id = new Types.ObjectId(String(postId));
    const [likeCount, commentCount] = await Promise.all([
      this.likes.countDocuments({ postId: id }).exec(),
      this.comments.countDocuments({ postId: id, hiddenAt: null }).exec(),
    ]);
    await this.posts
      .updateOne(
        { _id: id },
        { $set: { likeCount, commentCount, score: likeCount + commentCount } },
        { timestamps: false },
      )
      .exec();
    return likeCount;
  }

  private async visibleFilter(): Promise<QueryFilter<Post>> {
    const deactivated = await this.users
      .find({ status: UserStatus.DEACTIVATED })
      .distinct('_id')
      .exec();
    return {
      status: PostStatus.PUBLISHED,
      hiddenAt: null,
      authorId: { $nin: deactivated },
    };
  }

  private async findVisible(id: string): Promise<PostRow> {
    const post = await this.posts
      .findOne({ _id: id, ...(await this.visibleFilter()) })
      .lean()
      .exec();
    if (!post) throw new NotFoundException('Post not found');
    return post as PostRow;
  }

  private async findPost(id: string): Promise<PostDocument> {
    const post = await this.posts.findById(id).exec();
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  private async page(
    filter: QueryFilter<Post>,
    page: number,
    sort: Record<string, SortOrder>,
  ): Promise<Paginated<PostSummaryDto>> {
    const result = await paginate(this.posts, filter, { page, sort });
    const names = await this.names(result.items.map((p) => p.authorId));
    return {
      items: result.items.map((p) => this.toSummary(p as PostRow, names)),
      meta: result.meta,
    };
  }

  private async commentPage(postId: string, page: number) {
    const result = await paginate(
      this.comments,
      { postId: new Types.ObjectId(postId), hiddenAt: null },
      { page, sort: { createdAt: 1 } },
    );
    return {
      items: await this.toComments(result.items as CommentRow[]),
      meta: result.meta,
    };
  }

  /**
   * forAuthor: the author's own views show the attached itinerary whatever its
   * visibility; public views only while it is public and not hidden (BLG-13).
   */
  private async detail(p: PostRow, forAuthor = true): Promise<PostDetailDto> {
    const names = await this.names([p.authorId]);
    const summary = this.toSummary(p, names);
    return Object.assign(summary, {
      itinerary: await this.attachedItinerary(p, summary.author, forAuthor),
      body: p.body,
      images: p.images.map((i) => ({
        imageId: i.imageId.toString(),
        url: i.url,
      })),
      comments: await this.commentPage(p._id.toString(), 1),
    });
  }

  private toSummary(p: PostRow, names: Map<string, string>): PostSummaryDto {
    return {
      id: p._id.toString(),
      title: p.title,
      excerpt:
        p.body.length > EXCERPT_LENGTH
          ? `${p.body.slice(0, EXCERPT_LENGTH)}...`
          : p.body,
      author: {
        id: p.authorId.toString(),
        name: names.get(p.authorId.toString()) ?? DELETED_USER,
      },
      tags: p.tags,
      status: p.status,
      publishedAt: p.publishedAt,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      updatedAt: p.updatedAt,
    };
  }

  private async toComments(rows: CommentRow[]): Promise<CommentDto[]> {
    const names = await this.names(rows.map((c) => c.authorId));
    return rows.map((c) => ({
      id: c._id.toString(),
      postId: c.postId.toString(),
      author: {
        id: c.authorId.toString(),
        name: names.get(c.authorId.toString()) ?? DELETED_USER,
      },
      body: c.body,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  /** Author names; deactivated users are left out so they show as "Deleted user" (ACC-12). */
  private async names(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    const rows = await this.users
      .find(
        { _id: { $in: ids }, status: { $ne: UserStatus.DEACTIVATED } },
        { name: 1 },
      )
      .lean()
      .exec();
    return new Map(rows.map((u) => [u._id.toString(), u.name]));
  }
}
