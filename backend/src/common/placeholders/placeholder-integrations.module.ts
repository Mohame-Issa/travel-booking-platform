/**
 * ============================================================================
 *  TEMPORARY PLACEHOLDERS - DELETE EACH ONE WHEN THE REAL SERVICE IS MERGED
 * ============================================================================
 *
 * These stand in for teammates' services so the app starts and the code that
 * depends on them compiles before those services exist.
 *
 * HOW TO REPLACE A PLACEHOLDER (service owner, in your own PR):
 *   1. In your module, bind your service to the token and export it, and make
 *      the module @Global() (or ask the team leader where to import it):
 *        @Global()
 *        @Module({
 *          providers: [AuditService, { provide: AUDIT_SERVICE, useExisting: AuditService }],
 *          exports: [AUDIT_SERVICE],
 *        })
 *   2. Import your module in AppModule.
 *   3. Delete the matching entry from the `providers` and `exports` arrays below
 *      (and its class). Two providers for one token = whichever loads last wins,
 *      so do not leave both.
 *
 *   Token                              Owner             Placeholder behaviour
 *   (none - every shared service is implemented by its owner now)
 */
import { Global, Module } from '@nestjs/common';

/** Empty on purpose: add a TEMPORARY stand-in here only if a new shared token needs one. */
@Global()
@Module({ providers: [], exports: [] })
export class PlaceholderIntegrationsModule {}
