import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AirlinesModule } from '../airlines/airlines.module.js';
import { HotelsCatalogueModule } from '../hotels/hotels-catalogue.module.js';
import { UsersModule } from '../users/users.module.js';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule, UsersModule, AirlinesModule, HotelsCatalogueModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
