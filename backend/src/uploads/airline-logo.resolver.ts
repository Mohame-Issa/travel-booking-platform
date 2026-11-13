import { Injectable, Logger } from '@nestjs/common';
import type { AirlineLogoResolver } from '../airlines/airline-logo.interface.js';
import { UploadsService } from './uploads.service.js';

const logger = new Logger('UploadAirlineLogoResolver');

/**
 * FLT-01 / GEN-08: Yassin's AIRLINE_LOGO_RESOLVER. The upload must belong to the
 * actor and already passed the JPG/PNG and 5 MB checks in UploadsService.store.
 * One logo per airline: the previous logo is detached, then the new one attached
 * (restored if the attach fails).
 * Known gap: AirlinesService.update writes logoUrl after this returns; if that write
 * fails, the bookkeeping already points at the new asset. Reported to the airline owner.
 */
@Injectable()
export class UploadAirlineLogoResolver implements AirlineLogoResolver {
  constructor(private readonly uploads: UploadsService) {}

  async resolve(
    assetId: string,
    actorId: string,
    airlineId: string,
  ): Promise<string> {
    const owner = { type: 'airline' as const, id: airlineId };
    const asset = await this.uploads.findOwned(assetId, actorId);
    // An already-attached asset is either this airline's logo (no-op) or rejected
    // by attach; either way the current logo must stay.
    if (asset.ownerId) return this.uploads.attach(assetId, actorId, owner);
    const previous = await this.uploads.detachOwner(owner);
    try {
      return await this.uploads.attach(assetId, actorId, owner);
    } catch (err) {
      // keep the old logo owned; a concurrent replace may already hold the slot,
      // so a restore failure is logged and the original error still reaches the client
      await this.uploads
        .restore(previous, owner)
        .catch((e: Error) =>
          logger.warn(
            `Could not restore logo of airline ${airlineId}: ${e.message}`,
          ),
        );
      throw err;
    }
  }
}
