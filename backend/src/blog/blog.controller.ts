import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post as HttpPost,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import {
  CurrentUser,
  Public,
  Roles,
} from '../common/decorators/auth.decorators.js';
import {
  ApiPaginatedResponse,
  type Paginated,
} from '../common/dto/pagination.dto.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { BlogService } from './blog.service.js';
import {
  AttachPostImageDto,
  AuthorPageDto,
  AuthorPageQueryDto,
  CommentBodyDto,
  CommentDto,
  CommentPageDto,
  CreatePostDto,
  LikeStateDto,
  ListPostsQueryDto,
  PageQueryDto,
  PostDetailDto,
  PostSummaryDto,
  UpdatePostDto,
} from './dto/blog.dto.js';
import { Comment } from './schemas/comment.schema.js';
import { Post } from './schemas/post.schema.js';

const unauthorized = {
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
};
const forbidden = {
  type: ErrorResponseDto,
  description: 'INSUFFICIENT_ROLE or NOT_RESOURCE_OWNER',
};
const notFound = {
  type: ErrorResponseDto,
  description: 'Post not found (or not published)',
};
const bad = { type: ErrorResponseDto, description: 'VALIDATION_FAILED' };
const ownPost = () =>
  CheckOwnership({ model: Post.name, ownerField: 'authorId' });

/** Blog posts, comments, likes and images (BLG-01..BLG-10). Bonus scope. */
@ApiTags('Blog')
@Controller('posts')
export class PostsController {
  constructor(private readonly blog: BlogService) {}

  @HttpPost()
  @Roles(UserRole.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Create a post (BLG-01, BLG-08)',
    description:
      'Title and body required; up to 5 tags (max 30 characters each); status draft (default) or published.',
  })
  @ApiCreatedResponse({ type: PostDetailDto })
  @ApiBadRequestResponse(bad)
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePostDto,
  ): Promise<PostDetailDto> {
    return this.blog.create(userId, dto);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Browse or search published posts (BLG-02, BLG-09)',
    description:
      'Guests and users. Filter by ?tag. With ?q (keyword in title, tags or author name), results are ordered by ' +
      'interaction score (likes + comments), newest first on ties; otherwise newest first. An empty list means "no results".',
  })
  @ApiPaginatedResponse(PostSummaryDto)
  @ApiBadRequestResponse(bad)
  list(@Query() query: ListPostsQueryDto): Promise<Paginated<PostSummaryDto>> {
    return this.blog.listPublished(query);
  }

  // Literal "mine" routes are declared before ":id".
  @Get('mine')
  @Roles(UserRole.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'My posts, including drafts (BLG-03)',
    description:
      'Title, status, date, like count and comment count; last edited first.',
  })
  @ApiPaginatedResponse(PostSummaryDto)
  @ApiUnauthorizedResponse(unauthorized)
  mine(
    @CurrentUser('id') userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Paginated<PostSummaryDto>> {
    return this.blog.listMine(userId, query.page);
  }

  @Get('mine/:id')
  @Roles(UserRole.USER)
  @ownPost()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Open one of my posts in any state, e.g. a draft (BLG-03, BLG-04)',
  })
  @ApiOkResponse({ type: PostDetailDto })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  getMine(@Param('id', ParseObjectIdPipe) id: string): Promise<PostDetailDto> {
    return this.blog.getMine(id);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Open a published post (BLG-02)',
    description:
      'Title, author, date, body, tags, images, like count and the first 10 comments (chronological).',
  })
  @ApiOkResponse({ type: PostDetailDto })
  @ApiNotFoundResponse(notFound)
  getPublic(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PostDetailDto> {
    return this.blog.getPublic(id);
  }

  @Patch(':id')
  @Roles(UserRole.USER)
  @ownPost()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit my post, its tags or its status (BLG-04, BLG-08)',
    description: 'Send only what changes. Publishing a draft sets its date.',
  })
  @ApiOkResponse({ type: PostDetailDto })
  @ApiBadRequestResponse(bad)
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePostDto,
  ): Promise<PostDetailDto> {
    return this.blog.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.USER)
  @ownPost()
  @ApiCookieAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my post (BLG-04)',
    description:
      'With its comments and likes; its images are released. The frontend asks for confirmation (GEN-03).',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.blog.remove(id);
  }

  @Get(':id/comments')
  @Public()
  @ApiOperation({
    summary: "A published post's comments, chronological (BLG-05)",
  })
  @ApiOkResponse({ type: CommentPageDto })
  @ApiNotFoundResponse(notFound)
  comments(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.blog.listComments(id, query.page);
  }

  @HttpPost(':id/comments')
  @Roles(UserRole.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Comment on a published post (BLG-05)',
    description: 'Non-empty, max 500 characters.',
  })
  @ApiCreatedResponse({ type: CommentDto })
  @ApiBadRequestResponse(bad)
  @ApiUnauthorizedResponse(unauthorized)
  @ApiNotFoundResponse(notFound)
  addComment(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.blog.addComment(id, userId, dto.body);
  }

  @HttpPost(':id/like')
  @Roles(UserRole.USER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Like a post (BLG-06)',
    description: 'Once per user; liking again changes nothing.',
  })
  @ApiOkResponse({ type: LikeStateDto })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiNotFoundResponse(notFound)
  like(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<LikeStateDto> {
    return this.blog.like(id, userId);
  }

  @Delete(':id/like')
  @Roles(UserRole.USER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Remove my like (BLG-06)' })
  @ApiOkResponse({ type: LikeStateDto })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiNotFoundResponse(notFound)
  unlike(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<LikeStateDto> {
    return this.blog.unlike(id, userId);
  }

  @HttpPost(':id/images')
  @Roles(UserRole.USER)
  @ownPost()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Attach an image to my post (BLG-10, GEN-08)',
    description:
      'Upload with POST /api/uploads first (JPG or PNG, max 5 MB), then send its id. At most 5 per post.',
  })
  @ApiCreatedResponse({ type: PostDetailDto })
  @ApiBadRequestResponse(bad)
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'IMAGE_LIMIT_REACHED or ASSET_IN_USE',
  })
  attachImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AttachPostImageDto,
  ): Promise<PostDetailDto> {
    return this.blog.attachImage(id, userId, dto.imageId);
  }

  @Delete(':id/images/:imageId')
  @Roles(UserRole.USER)
  @ownPost()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Remove an image from my post (BLG-10)' })
  @ApiOkResponse({ type: PostDetailDto })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  detachImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId', ParseObjectIdPipe) imageId: string,
  ): Promise<PostDetailDto> {
    return this.blog.detachImage(id, imageId);
  }
}

/** Editing and deleting my comments (BLG-07). */
@ApiTags('Blog')
@ApiCookieAuth()
@ApiUnauthorizedResponse(unauthorized)
@ApiForbiddenResponse(forbidden)
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Comment not found',
})
@Roles(UserRole.USER)
@Controller('comments/:id')
export class CommentsController {
  constructor(private readonly blog: BlogService) {}

  @Patch()
  @CheckOwnership({ model: Comment.name, ownerField: 'authorId' })
  @ApiOperation({
    summary: 'Edit my comment (BLG-07)',
    description: 'Non-empty, max 500 characters.',
  })
  @ApiOkResponse({ type: CommentDto })
  @ApiBadRequestResponse(bad)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.blog.updateComment(id, dto.body);
  }

  @Delete()
  @CheckOwnership({ model: Comment.name, ownerField: 'authorId' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete my comment (BLG-07)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.blog.removeComment(id);
  }
}

/** Clickable tags (BLG-08) and public author pages (BLG-12). */
@ApiTags('Blog')
@Controller()
export class BlogBrowseController {
  constructor(private readonly blog: BlogService) {}

  @Get('tags/:tag/posts')
  @Public()
  @ApiOperation({
    summary: 'Published posts with a tag (BLG-08)',
    description: 'Newest first, 10 per page.',
  })
  @ApiPaginatedResponse(PostSummaryDto)
  byTag(
    @Param('tag') tag: string,
    @Query() query: PageQueryDto,
  ): Promise<Paginated<PostSummaryDto>> {
    return this.blog.byTag(tag, query.page);
  }

  @Get('authors/:id')
  @Public()
  @ApiOperation({
    summary: 'Public author page (BLG-12)',
    description:
      'Name, join date, published posts and public itineraries (each paginated). Deactivated authors: 404 (ACC-12).',
  })
  @ApiOkResponse({ type: AuthorPageDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Author not found',
  })
  author(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: AuthorPageQueryDto,
  ): Promise<AuthorPageDto> {
    return this.blog.authorPage(id, query.postsPage, query.itinerariesPage);
  }
}
