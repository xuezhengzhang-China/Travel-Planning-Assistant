import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { Proposal } from '../b/types';

@Injectable()
export class ProposalsRepository {
  constructor(private readonly db: DatabaseService) {}
  async save(ownerId: string, proposal: Proposal): Promise<void> {
    await this.db.query(
      `INSERT INTO recommendation_proposals
      (id, owner_id, input_snapshot, proposal, generated_at, expires_at) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [
        proposal.proposalId,
        ownerId,
        JSON.stringify(proposal.inputSnapshot),
        JSON.stringify(proposal),
        proposal.generatedAt,
        proposal.expiresAt,
      ],
    );
  }
  async getOwned(id: string, ownerId: string): Promise<Proposal | null> {
    const result = await this.db.query<{ proposal: Proposal }>(
      'SELECT proposal FROM recommendation_proposals WHERE id = $1 AND owner_id = $2',
      [id, ownerId],
    );
    return result.rows[0]?.proposal ?? null;
  }
}
