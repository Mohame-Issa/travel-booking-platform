import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import {
  BlogBrowseController,
  CommentsController,
  PostsController,
} from './blog.controller.js';
import { BlogService } from './blog.service.js';
import { Comment, CommentSchema } from './schemas/comment.schema.js';
import { Like, LikeSchema } from './schemas/like.schema.js';
import { Post, PostSchema } from './schemas/post.schema.js';

/**
 * Blog (BLG-01..BLG-12): bonus scope for this team (TA email, 16 November).
 * Taken over from Omar Rashed's part. Itineraries are imported for the author
 * page (BLG-12); images use the global upload service (GEN-08).
 */
@Module({
  imports: [
    ItinerariesModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
    ]),
  ],
  controllers: [PostsController, CommentsController, BlogBrowseController],
  providers: [BlogService],
  exports: [BlogService, MongooseModule],
})
export class BlogModule {}
