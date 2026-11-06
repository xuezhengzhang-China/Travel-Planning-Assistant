import { DynamicModule, Module } from '@nestjs/common';
import type { ModuleMetadata, Provider } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { PlacesRepository } from '../places/places.repository';
import { PlacesService } from '../places/places.service';
import { AmapClient, B_FETCH } from '../integrations/amap/amap.client';
import { GeoService } from '../integrations/amap/geo.service';
import { ProposalsRepository } from '../recommendations/proposals.repository';
import {
  B_CLOCK,
  B_ID_GENERATOR,
  PROPOSAL_READER,
  RecommendationsService,
  systemId,
} from '../recommendations/recommendations.service';
import { BController } from './controllers';
import { B_AUTHENTICATOR, BIdentityGuard } from './identity';
import { BConfig } from './config';
import { LlmAdvisor } from '../integrations/llm/llm.advisor';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [BController],
  providers: [
    PlacesRepository,
    PlacesService,
    AmapClient,
    GeoService,
    ProposalsRepository,
    RecommendationsService,
    BConfig,
    BIdentityGuard,
    LlmAdvisor,
    { provide: B_AUTHENTICATOR, useValue: { authenticate: async () => null } },
    { provide: B_FETCH, useValue: (...args: Parameters<typeof fetch>) => fetch(...args) },
    { provide: B_CLOCK, useValue: () => new Date() },
    { provide: B_ID_GENERATOR, useValue: systemId },
    { provide: PROPOSAL_READER, useExisting: RecommendationsService },
  ],
  exports: [PlacesService, GeoService, AmapClient, PROPOSAL_READER],
})
export class BModule {
  // C supplies the trusted token verifier via a provider; no production mock identity exists.
  static register(options: {
    imports?: ModuleMetadata['imports'];
    providers?: Provider[];
  }): DynamicModule {
    return { module: BModule, imports: options.imports ?? [], providers: options.providers ?? [] };
  }
}
