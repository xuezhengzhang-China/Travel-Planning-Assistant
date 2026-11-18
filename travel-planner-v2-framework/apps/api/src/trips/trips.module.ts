import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ProposalsRepository } from '../recommendations/proposals.repository';
import { BPlacesCatalog } from './places-catalog';
import { BProposalReader, ProposalReader } from './proposal-reader';
import { TripCatalog } from './trip-catalog';
import { TripRepository, PostgresTripRepository } from './trip.repository';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [TripsController],
  providers: [
    TripsService,
    ProposalsRepository,
    { provide: TripRepository, useClass: PostgresTripRepository },
    { provide: TripCatalog, useClass: BPlacesCatalog },
    { provide: ProposalReader, useClass: BProposalReader },
  ],
  exports: [TripsService],
})
export class TripsModule {}
