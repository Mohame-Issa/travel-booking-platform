import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  AuditLogInput,
  AuditService,
} from '../common/interfaces/index.js';
import { paginate } from '../common/utils/paginate.js';
import type { AuditLogQueryDto } from './dto/audit-log.dto.js';
import { AuditLog } from './schemas/audit-log.schema.js';

/** GEN-07. Bound to AUDIT_SERVICE; errors propagate so an action is never silently unaudited. */
@Injectable()
export class AuditLogService implements AuditService {
  constructor(
    @InjectModel(AuditLog.name) private readonly logs: Model<AuditLog>,
  ) {}

  async record(input: AuditLogInput): Promise<void> {
    await this.logs.create(input);
  }

  list({ page, action, targetType, actorId }: AuditLogQueryDto) {
    const filter = {
      ...(action && { action }),
      ...(targetType && { targetType }),
      ...(actorId && { actorId }),
    };
    return paginate(this.logs, filter, { page, sort: { createdAt: -1 } });
  }
}
