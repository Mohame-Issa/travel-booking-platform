import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModeratorAssignmentsService } from './moderator-assignments.service.js';
import {
  ModeratorAssignment,
  ModeratorAssignmentSchema,
} from './schemas/moderator-assignment.schema.js';
import { User, UserSchema } from './schemas/user.schema.js';
import { UsersService } from './users.service.js';

/**
 * Global so every module can inject UsersService and
 * ModeratorAssignmentsService (used by the @ModeratorOfProvider guard).
 * MongooseModule is exported so modules that need the raw User or
 * ModeratorAssignment model (e.g. admin, seeding) can use @InjectModel.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ModeratorAssignment.name, schema: ModeratorAssignmentSchema },
    ]),
  ],
  providers: [UsersService, ModeratorAssignmentsService],
  exports: [UsersService, ModeratorAssignmentsService, MongooseModule],
})
export class UsersModule {}
