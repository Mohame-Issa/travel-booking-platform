import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/guards/auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { PlaceholderIntegrationsModule } from './common/placeholders/placeholder-integrations.module.js';
import { validateEnv } from './config/env.validation.js';
import { HealthController } from './health/health.controller.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        onConnectionCreate: (connection: Connection) => {
          // Log only the database NAME, never the connection string.
          connection.on('connected', () =>
            new Logger('MongoDB').log(
              `Connected to database "${connection.name}"`,
            ),
          );
          return connection;
        },
      }),
    }),

    // TEMPORARY: remove entries from this module as teammates merge the real services.
    PlaceholderIntegrationsModule,

    UsersModule,
    AuthModule,
    // Feature modules are added below this line, one per teammate PR.
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
