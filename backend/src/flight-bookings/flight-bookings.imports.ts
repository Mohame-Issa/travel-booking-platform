/**
 * ONE place for imports from teammates' folders.
 * If a path is red/wrong, fix it HERE only (use the path of the real file).
 */
export { ApiException } from '../common/exceptions/api.exception.js';
export { ErrorCode } from '../common/constants/error-codes.js';
export { UserRole, ProviderType } from '../common/constants/roles.js';
export { Roles, CurrentUser } from '../common/decorators/auth.decorators.js';
export { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
export { PaginationQueryDto } from '../common/dto/pagination.dto.js';
export { paginate } from '../common/utils/paginate.js';
export * from '../common/interfaces/index.js';

export { Flight, FlightSchema } from '../flights/schemas/flight.schema.js';
export {
  CabinInventory,
  CabinInventorySchema,
} from '../flights/schemas/cabin-inventory.schema.js';
export { FlightStatus, CabinClass } from '../flights/catalogue.constants.js';
export { FlightsModule } from '../flights/flights.module.js';
export {
  FlightEventsService,
  FLIGHT_CANCELLED,
  FLIGHT_UPDATED,
} from '../flights/flight-events.service.js';
export type { FlightEventPayload } from '../flights/flight-events.service.js';

export { Airline, AirlineSchema } from '../airlines/schemas/airline.schema.js';
export {
  AirlinePolicy,
  AirlinePolicySchema,
} from '../airlines/schemas/airline-policy.schema.js';
export { Airport, AirportSchema } from '../airports/schemas/airport.schema.js';

export { ModeratorAssignmentsService } from '../users/moderator-assignments.service.js';
export type { AuthenticatedUser } from '../common/types/authenticated-user.js';