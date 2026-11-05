import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProviderType } from '../../common/constants/roles.js';

/**
 * Links a moderator account to exactly one airline or hotel.
 * Collection: "moderatorassignments".
 *
 * Created by Omar Rashed's POST /api/admin/moderators (ACC-13) and by
 * Yassin Shawr's seed script. Read by ModeratorAssignmentsService and the
 * @ModeratorOfProvider() guard.
 */
@Schema({ timestamps: true, collection: 'moderatorassignments' })
export class ModeratorAssignment {
  /** Unique: a moderator has exactly one assignment. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  moderatorId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ProviderType), required: true })
  providerType: ProviderType;

  /** _id of the Airline or Hotel document (depending on providerType). */
  @Prop({ type: Types.ObjectId, required: true, index: true })
  providerId: Types.ObjectId;

  /** Admin who created the assignment; null when seeded. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ModeratorAssignmentDocument = HydratedDocument<ModeratorAssignment>;
export const ModeratorAssignmentSchema =
  SchemaFactory.createForClass(ModeratorAssignment);
