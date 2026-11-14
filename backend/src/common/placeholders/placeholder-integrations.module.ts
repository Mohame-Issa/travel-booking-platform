/**
 * TEMPORARY PLACEHOLDERS - add an entry here only when a new shared token needs a stand-in.
 *
 *   (none - every shared service is implemented by its owner now)
 */
import { Global, Module } from '@nestjs/common';

/** Empty on purpose: add a TEMPORARY stand-in here only if a new shared token needs one. */
@Global()
@Module({ providers: [], exports: [] })
export class PlaceholderIntegrationsModule {}