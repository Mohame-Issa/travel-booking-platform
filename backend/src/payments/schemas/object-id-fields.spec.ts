import { describe, expect, it } from 'vitest';
import { RefundSchema } from '../../refunds/schemas/refund.schema.js';
import { PaymentSchema } from './payment.schema.js';
import { PolicyAcceptanceSchema } from './policy-acceptance.schema.js';

/**
 * `@Prop({ type: Types.ObjectId })` is silently stored as Mixed by this
 * mongoose version: no casting, so a query with a string id finds nothing.
 * The schemas must use `MongooseSchema.Types.ObjectId`.
 */
describe('id fields are real ObjectId paths', () => {
  const cases: [string, typeof PaymentSchema, string[]][] = [
    ['Payment', PaymentSchema as never, ['userId', 'bookingId']],
    [
      'PolicyAcceptance',
      PolicyAcceptanceSchema as never,
      ['userId', 'bookingId'],
    ],
    [
      'Refund',
      RefundSchema as never,
      ['paymentId', 'userId', 'bookingId', 'requestedBy'],
    ],
  ];
  for (const [name, schema, paths] of cases) {
    it(`${name}: ${paths.join(', ')}`, () => {
      for (const path of paths)
        expect(schema.path(path).instance).toBe('ObjectId');
    });
  }
});
