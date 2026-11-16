import { describe, expect, it } from 'vitest';
import { SessionSchema } from '../../auth/schemas/session.schema.js';
import { ModeratorAssignmentSchema } from './moderator-assignment.schema.js';

/**
 * `@Prop({ type: Types.ObjectId })` becomes Mixed with this mongoose version,
 * so string ids are not cast and queries silently match nothing (AI_RULES §9).
 */
describe('auth/users id fields are real ObjectId paths', () => {
  it.each([
    [
      'ModeratorAssignment',
      ModeratorAssignmentSchema,
      ['moderatorId', 'providerId', 'assignedBy'],
    ],
    ['Session', SessionSchema, ['userId']],
  ] as const)('%s', (_name, schema, paths) => {
    for (const path of paths)
      expect(schema.path(path).instance).toBe('ObjectId');
  });
});
