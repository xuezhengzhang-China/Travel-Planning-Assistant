import { RouterModule } from '@nestjs/core';
import { BModule } from './b/b.module';
import { B_AUTHENTICATOR } from './b/identity';
import { AuthService } from './auth/auth.service';
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TripsModule } from './trips/trips.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    TripsModule,
    BModule.register({
      imports: [AuthModule],
      providers: [
        {
          provide: B_AUTHENTICATOR,
          inject: [AuthService],
          useFactory: (auth: AuthService) => ({
            async authenticate(header: string | undefined) {
              if (!header?.startsWith('Bearer ')) return null;
              const userId = await auth.verifyAccessToken(header.slice(7).trim());
              return userId ? { userId } : null;
            },
          }),
        },
      ],
    }),
    RouterModule.register([{ path: 'b', module: BModule }]),
  ],
})
export class AppModule {}
