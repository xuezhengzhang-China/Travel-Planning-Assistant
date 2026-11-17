import { Injectable } from '@nestjs/common';
import type { Proposal } from '@travel/shared' with { 'resolution-mode': 'import' };
import { ApiError } from '../common/api-error';
import { ProposalsRepository } from '../recommendations/proposals.repository';

/** 行程业务只需要读取自己名下的方案；实现由 B 的方案仓库提供。 */
export abstract class ProposalReader {
  abstract getOwnedProposal(id: string, userId: string): Promise<Proposal>;
}

@Injectable()
export class BProposalReader extends ProposalReader {
  constructor(private readonly proposals: ProposalsRepository) {
    super();
  }

  async getOwnedProposal(id: string, userId: string): Promise<Proposal> {
    const proposal = await this.proposals.getOwned(id, userId);
    if (!proposal) throw new ApiError('NOT_FOUND', '推荐方案不存在或已失效', 404);
    // B 的 Proposal 与共享契约字段一致；这里只做跨模块类型收敛。
    return proposal as unknown as Proposal;
  }
}
