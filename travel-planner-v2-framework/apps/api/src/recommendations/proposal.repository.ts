import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Proposal } from '@travel/shared' with { 'resolution-mode': 'import' };
import { DatabaseService } from '../database/database.service';
export abstract class ProposalReader {
  abstract getOwnedProposal(id: string, userId: string): Promise<Proposal>;
}
export abstract class ProposalRepository {
  abstract save(ownerId: string, proposal: Proposal): Promise<void>;
  abstract getOwned(id: string, ownerId: string): Promise<Proposal | null>;
}
@Injectable()
export class PostgresProposalRepository extends ProposalRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }
  async save(ownerId: string, proposal: Proposal) {
    await this.db.query(
      'INSERT INTO recommendation_proposals(id,owner_id,payload,expires_at) VALUES($1,$2,$3::jsonb,$4)',
      [proposal.proposalId, ownerId, JSON.stringify(proposal), proposal.expiresAt],
    );
  }
  async getOwned(id: string, ownerId: string) {
    const result = await this.db.query<{ payload: Proposal }>(
      'SELECT payload FROM recommendation_proposals WHERE id=$1 AND owner_id=$2',
      [id, ownerId],
    );
    return result.rows[0]?.payload ?? null;
  }
}
export abstract class RecommendationClock {
  abstract now(): Date;
}
@Injectable()
export class SystemRecommendationClock extends RecommendationClock {
  now() {
    return new Date();
  }
}
export const proposalId = () => randomUUID();
