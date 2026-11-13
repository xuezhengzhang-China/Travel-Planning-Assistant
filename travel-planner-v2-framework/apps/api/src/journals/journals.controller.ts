import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Journal } from '@travel/shared' with {
  'resolution-mode': 'import',
};
import {
  FootprintsAuthGuard,
  type AuthenticatedRequest,
} from '../footprints/footprints-auth.guard';
import { CurrentUser } from '../footprints/request-user.decorator';
import {
  isUuid,
  validateJournalCreate,
  validateJournalUpdate,
  type ValidatedJournalCreate,
} from './journals.dto';
import { JournalsService } from './journals.service';

@Controller('journals')
@UseGuards(FootprintsAuthGuard)
export class JournalsController {
  constructor(private readonly journals: JournalsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Query('footprintId') footprintId?: string,
    @Query('year') yearQuery?: string,
    @Query('page') pageQuery?: string,
    @Query('pageSize') pageSizeQuery?: string,
  ) {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    if (footprintId !== undefined && !isUuid(footprintId)) {
      throw new BadRequestException('footprintId must be a valid UUID');
    }
    const year = parseOptionalInteger(yearQuery, 'year', 1000, 9999);
    const page = parseOptionalInteger(pageQuery, 'page', 1, Number.MAX_SAFE_INTEGER) ?? 1;
    const pageSize = parseOptionalInteger(pageSizeQuery, 'pageSize', 1, 100) ?? 20;
    if (!Number.isSafeInteger((page - 1) * pageSize)) {
      throw new BadRequestException('page and pageSize exceed the supported range');
    }
    return this.journals.list(user.id, footprintId ?? null, year, page, pageSize);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() body: Record<string, unknown>,
  ): Promise<Journal> {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    const input: ValidatedJournalCreate = validateJournalCreate(body);
    return this.journals.create(user.id, input);
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id', new ParseUUIDPipe()) journalId: string,
  ): Promise<Journal> {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    return this.journals.getById(user.id, journalId);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id', new ParseUUIDPipe()) journalId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<Journal> {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    const update = validateJournalUpdate(body);
    return this.journals.update(user.id, journalId, update);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id', new ParseUUIDPipe()) journalId: string,
  ): Promise<void> {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    await this.journals.delete(user.id, journalId);
  }
}

function parseOptionalInteger(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(`${name} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(`${name} is outside the supported range`);
  }
  return parsed;
}
