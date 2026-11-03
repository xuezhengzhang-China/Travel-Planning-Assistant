import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { FootprintEntry } from '@travel/shared' with { 'resolution-mode': 'import' };
import { FootprintsAuthGuard, type AuthenticatedRequest } from './footprints-auth.guard';
import { FootprintsService } from './footprints.service';
import {
  MAX_UPLOAD_BYTES,
  validateFootprintInput,
  validateFootprintUpdate,
  validateUpload,
  type UploadedMedia,
} from './footprints.dto';
import { CurrentUser } from './request-user.decorator';

@Controller('footprints')
export class FootprintsController {
  constructor(private readonly footprints: FootprintsService) {}

  @Get()
  @UseGuards(FootprintsAuthGuard)
  async list(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Query('year') yearQuery?: string,
    @Query('page') pageQuery?: string,
    @Query('pageSize') pageSizeQuery?: string,
  ) {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    const year = parseOptionalInteger(yearQuery, 'year', 1000, 9999);
    const page = parseOptionalInteger(pageQuery, 'page', 1, Number.MAX_SAFE_INTEGER) ?? 1;
    const pageSize = parseOptionalInteger(pageSizeQuery, 'pageSize', 1, 100) ?? 20;
    if (!Number.isSafeInteger((page - 1) * pageSize)) {
      throw new BadRequestException('page and pageSize exceed the supported range');
    }
    return this.footprints.list(user.id, year, page, pageSize);
  }

  @Post()
  @UseGuards(FootprintsAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async create(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: UploadedMedia | undefined,
  ): Promise<FootprintEntry> {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    const input = validateFootprintInput(body, Boolean(file));
    const upload = file ? validateUpload(file) : undefined;
    return this.footprints.create(user.id, input, file, upload);
  }

  @Get('places/search')
  @UseGuards(FootprintsAuthGuard)
  async searchPlaces(@Query('keywords') keyword: string) {
    const trimmed = keyword?.trim();
    if (!trimmed || trimmed.length > 80) {
      throw new BadRequestException('keywords must contain 1 to 80 characters');
    }
    return this.footprints.searchPlaces(trimmed);
  }

  @Get('map')
  @UseGuards(FootprintsAuthGuard)
  async getMapData(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Query('provinceAdcode') provinceAdcode?: string,
    @Query('year') yearQuery?: string,
  ) {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    if (provinceAdcode && !/^\d{6}$/.test(provinceAdcode)) {
      throw new BadRequestException('provinceAdcode must be a six-digit administrative code');
    }
    const year = parseOptionalInteger(yearQuery, 'year', 1000, 9999);
    return this.footprints.getMapData(user.id, provinceAdcode ?? null, year);
  }

  @Get('media/:id')
  @UseGuards(FootprintsAuthGuard)
  @Header('X-Content-Type-Options', 'nosniff')
  async readMedia(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id', new ParseUUIDPipe()) mediaId: string,
  ): Promise<StreamableFile> {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    const media = await this.footprints.readMedia(user.id, mediaId);
    return new StreamableFile(media.bytes, {
      type: media.mimeType,
      disposition: 'inline',
    });
  }

  @Get(':id')
  @UseGuards(FootprintsAuthGuard)
  async getById(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id', new ParseUUIDPipe()) entryId: string,
  ) {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    return this.footprints.getById(user.id, entryId);
  }

  @Patch(':id')
  @UseGuards(FootprintsAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async update(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id', new ParseUUIDPipe()) entryId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: UploadedMedia | undefined,
  ) {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    const existing = await this.footprints.getById(user.id, entryId);
    const update = validateFootprintUpdate(body, Boolean(file), existing);
    const upload = file ? validateUpload(file) : undefined;
    return this.footprints.update(user.id, entryId, update, file, upload);
  }

  @Delete(':id')
  @UseGuards(FootprintsAuthGuard)
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id', new ParseUUIDPipe()) entryId: string,
  ): Promise<void> {
    if (!user) throw new BadRequestException('Authenticated user context is missing');
    await this.footprints.delete(user.id, entryId);
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
