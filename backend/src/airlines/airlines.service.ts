import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProviderType } from '../common/constants/roles.js';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { ProviderStatus } from '../flights/catalogue.constants.js';
import { conflict, invalid } from '../flights/catalogue-validation.js';
import { ModeratorAssignmentsService } from '../users/moderator-assignments.service.js';
import {
  AIRLINE_LOGO_RESOLVER,
  type AirlineLogoResolver,
} from './airline-logo.interface.js';
import {
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto.js';
import { Airline } from './schemas/airline.schema.js';
import { AirlinePolicy } from './schemas/airline-policy.schema.js';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(AirlinePolicy.name)
    private readonly policies: Model<AirlinePolicy>,
    private readonly assignments: ModeratorAssignmentsService,
    @Inject(AIRLINE_LOGO_RESOLVER) private readonly logos: AirlineLogoResolver,
  ) {}
  create(dto: CreateAirlineDto) {
    if (dto.currency !== PLATFORM_CURRENCY)
      invalid(
        `Airline currency must be ${PLATFORM_CURRENCY} (PAY-04)`,
        'currency',
      );
    return this.airlines.create(dto);
  }
  async get(id: string) {
    const airline = await this.airlines.findById(id).lean().exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return airline;
  }
  async assertActive(id: string) {
    const airline = await this.assertCurrency(id);
    if (airline.status !== ProviderStatus.ACTIVE)
      conflict('Airline is deactivated');
    return airline;
  }
  async assertCurrency(id: string) {
    const airline = await this.get(id);
    if (airline.currency !== PLATFORM_CURRENCY)
      invalid(
        `Legacy provider currency requires review; catalogue prices must use ${PLATFORM_CURRENCY} (PAY-04)`,
        'currency',
      );
    return airline;
  }
  async update(id: string, dto: UpdateAirlineDto, user: AuthenticatedUser) {
    await this.assignments.assertCanManage(user, ProviderType.AIRLINE, id);
    await this.get(id);
    const { logoAssetId, ...profile } = dto;
    const changes = {
      ...profile,
      ...(logoAssetId !== undefined
        ? { logoUrl: await this.logos.resolve(logoAssetId, user.id, id) }
        : {}),
    };
    if (!Object.keys(changes).length)
      invalid('Supply at least one profile field');
    const airline = await this.airlines
      .findByIdAndUpdate(
        id,
        { $set: changes },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return airline;
  }
  async setBaggage(id: string, dto: BaggagePolicyDto, user: AuthenticatedUser) {
    await this.assignments.assertCanManage(user, ProviderType.AIRLINE, id);
    await this.assertCurrency(id);
    return this.policies
      .findOneAndUpdate(
        { airlineId: id },
        { $set: dto },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .exec();
  }
  async setCancellation(
    id: string,
    dto: CancellationPolicyDto,
    user: AuthenticatedUser,
  ) {
    await this.assignments.assertCanManage(user, ProviderType.AIRLINE, id);
    await this.get(id);
    if (
      new Set(dto.tiers.map((tier) => tier.daysBefore)).size !==
      dto.tiers.length
    )
      invalid('Cancellation thresholds must be unique');
    return this.policies
      .findOneAndUpdate(
        { airlineId: id },
        {
          $set: {
            cancellationTiers: [...dto.tiers].sort(
              (a, b) => b.daysBefore - a.daysBefore,
            ),
          },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .exec();
  }
  policy(id: string) {
    return this.policies.findOne({ airlineId: id }).lean().exec();
  }
}
