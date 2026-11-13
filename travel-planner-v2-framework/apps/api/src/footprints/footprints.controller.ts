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
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { FootprintsService } from './footprints.service';
import {
  MAX_UPLOAD_BYTES,
  validateFootprintInput,
  validateFootprintUpdate,
  validateUpload,
  type UploadedMedia,
} from './footprints.dto';

@Controller('footprints')
export class FootprintsController {
  constructor(private readonly footprints: FootprintsService) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') yearQuery?: string,
    @Query('page') pageQuery?: string,
    @Query('pageSize') pageSizeQuery?: string,
  ) {
    const year = parseOptionalInteger(yearQuery, 'year', 1000, 9999);
    const page = parseOptionalInteger(pageQuery, 'page', 1, Number.MAX_SAFE_INTEGER) ?? 1;
    const pageSize = parseOptionalInteger(pageSizeQuery, 'pageSize', 1, 100) ?? 20;
    if (!Number.isSafeInteger((page - 1) * pageSize)) {
      throw new BadRequestException('page and pageSize exceed the supported range');
    }
    return this.footprints.list(user.userId, year, page, pageSize);
  }

  @Post()
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: UploadedMedia | undefined,
  ): Promise<FootprintEntry> {
    const input = validateFootprintInput(body, Boolean(file));
    const upload = file ? validateUpload(file) : undefined;
    return this.footprints.create(user.userId, input, file, upload);
  }

  @Get('places/search')
  @UseGuards(AuthGuard)
  async searchPlaces(@Query('keywords') keyword: string) {
    const trimmed = keyword?.trim();
    if (!trimmed || trimmed.length > 80) {
      throw new BadRequestException('keywords must contain 1 to 80 characters');
    }
    return this.footprints.searchPlaces(trimmed);
  }

  @Get('map')
  @UseGuards(AuthGuard)
  async getMapData(
    @CurrentUser() user: AuthenticatedUser,
    @Query('provinceAdcode') provinceAdcode?: string,
    @Query('year') yearQuery?: string,
  ) {
    if (provinceAdcode && !/^\d{6}$/.test(provinceAdcode)) {
      throw new BadRequestException('provinceAdcode must be a six-digit administrative code');
    }
    const year = parseOptionalInteger(yearQuery, 'year', 1000, 9999);
    return this.footprints.getMapData(user.userId, provinceAdcode ?? null, year);
  }

  @Get('media/:id')
  @UseGuards(AuthGuard)
  @Header('X-Content-Type-Options', 'nosniff')
  async readMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) mediaId: string,
  ): Promise<StreamableFile> {
    const media = await this.footprints.readMedia(user.userId, mediaId);
    return new StreamableFile(media.bytes, {
      type: media.mimeType,
      disposition: 'inline',
    });
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) entryId: string,
  ) {
    return this.footprints.getById(user.userId, entryId);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) entryId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: UploadedMedia | undefined,
  ) {
    const existing = await this.footprints.getById(user.userId, entryId);
    const update = validateFootprintUpdate(body, Boolean(file), existing);
    const upload = file ? validateUpload(file) : undefined;
    return this.footprints.update(user.userId, entryId, update, file, upload);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) entryId: string,
  ): Promise<void> {
    await this.footprints.delete(user.userId, entryId);
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
