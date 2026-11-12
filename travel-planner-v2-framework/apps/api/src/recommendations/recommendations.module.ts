import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlacesModule } from '../places/places.module';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './c-recommendations.service';
import {
  ProposalRepository,
  PostgresProposalRepository,
  ProposalReader,
  RecommendationClock,
  SystemRecommendationClock,
} from './proposal.repository';
@Module({
  imports: [AuthModule, DatabaseModule, PlacesModule],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    { provide: ProposalRepository, useClass: PostgresProposalRepository },
    { provide: ProposalReader, useExisting: RecommendationsService },
    { provide: RecommendationClock, useClass: SystemRecommendationClock },
  ],
  exports: [ProposalReader, RecommendationsService],
})
export class RecommendationsModule {}
