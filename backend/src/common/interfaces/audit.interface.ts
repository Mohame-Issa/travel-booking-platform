/**
 * Audit log contract (GEN-07). Owner: Mohamed Hashad (backend/src/audit).
 * Any module records an administrative action like this:
 *
 *   constructor(@Inject(AUDIT_SERVICE) private readonly audit: AuditService) {}
 *
 *   await this.audit.record({
 *     actorId: admin.id,
 *     action: 'user.password_reset',
 *     targetType: 'User',
 *     targetId: userId,
 *   });
 *
 * Action naming: '<entity>.<verb_past_tense>' in snake_case, e.g.
 * 'user.suspended', 'provider.deactivated', 'post.hidden', 'report.dismissed'.
 */

export interface AuditLogInput {
  /** Admin (or system user) who performed the action. */
  actorId: string;
  action: string;
  /** Model name of what was affected, e.g. 'User', 'Hotel', 'BlogPost'. */
  targetType: string;
  targetId?: string;
  /** Extra context. Never put passwords or tokens here. */
  details?: Record<string, unknown>;
}

export interface AuditService {
  record(input: AuditLogInput): Promise<void>;
}

export const AUDIT_SERVICE = 'AUDIT_SERVICE';
