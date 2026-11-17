import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MediaAsset } from '@travel/shared' with { 'resolution-mode': 'import' };
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { validateMediaUpload } from './media.dto';
import { MediaService } from './media.service';
import type { UploadedMedia } from '../footprints/footprints.dto';

// 拦截器上限略高于业务上限，让超限文件能走到校验层并返回 FILE_TOO_LARGE。
const INTERCEPTOR_LIMIT_BYTES = 12 * 1024 * 1024;

@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: INTERCEPTOR_LIMIT_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedMedia | undefined,
  ): Promise<MediaAsset> {
    const upload = validateMediaUpload(file);
    return this.media.upload(user.userId, upload.file, upload);
  }

  @Get(':id')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) mediaId: string,
  ): Promise<StreamableFile> {
    const media = await this.media.read(user.userId, mediaId);
    return new StreamableFile(media.bytes, { type: media.mimeType, disposition: 'inline' });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) mediaId: string,
  ): Promise<void> {
    await this.media.remove(user.userId, mediaId);
  }
}
