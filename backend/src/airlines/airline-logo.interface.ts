import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../common/exceptions/api.exception.js';
import { ErrorCode } from '../common/constants/error-codes.js';

/** Hashad resolves an owned, validated JPG/PNG <=5MB upload to its served URL (GEN-08). */
export interface AirlineLogoResolver {
  resolve(assetId: string, actorId: string, airlineId: string): Promise<string>;
}
export const AIRLINE_LOGO_RESOLVER = 'AIRLINE_LOGO_RESOLVER';

@Injectable()
export class PendingAirlineLogoResolver implements AirlineLogoResolver {
  resolve(): Promise<string> {
    return Promise.reject(
      new ApiException(
        HttpStatus.NOT_IMPLEMENTED,
        ErrorCode.NOT_IMPLEMENTED,
        'The shared image-upload service has not been integrated; airline names and codes can still be edited',
      ),
    );
  }
}
