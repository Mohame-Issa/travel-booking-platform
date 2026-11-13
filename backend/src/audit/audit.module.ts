import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AUDIT_SERVICE } from '../common/interfaces/index.js';
import { AuditController } from './audit.controller.js';
import { AuditLogService } from './audit.service.js';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema.js';

/** GEN-07. Global so any module can inject AUDIT_SERVICE. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AuditController],
  providers: [
    AuditLogService,
    { provide: AUDIT_SERVICE, useExisting: AuditLogService },
  ],
  exports: [AUDIT_SERVICE],
})
export class AuditModule {}
