import {
  HttpCode,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JsonBodyPipe, rejectUnknownFields } from '../common/json-body.pipe';
import { TripsService } from './trips.service';
import {
  createInput,
  patchInput,
  selectionsInput,
  uuid,
  pagination,
  revision,
  scheduleInput,
} from './trip-validation';
@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  constructor(private readonly trips: TripsService) {}
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('expectedRevision') expectedRevision: string,
  ) {
    return this.trips.remove(user.userId, uuid(id, 'id'), revision(Number(expectedRevision)));
  }
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JsonBodyPipe()) body: Record<string, unknown>,
  ) {
    return this.trips.create(user.userId, createInput(body));
  }
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') size?: string,
  ) {
    const p = pagination(page, size);
    return this.trips.list(user.userId, p.page, p.pageSize);
  }
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trips.get(user.userId, uuid(id, 'id'));
  }
  @Patch(':id')
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new JsonBodyPipe()) body: Record<string, unknown>,
  ) {
    return this.trips.update(user.userId, uuid(id, 'id'), patchInput(body));
  }
  @Put(':id/selections')
  selections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new JsonBodyPipe()) body: Record<string, unknown>,
  ) {
    return this.trips.selections(user.userId, uuid(id, 'id'), selectionsInput(body));
  }
  @Post(':id/apply-proposal')
  @HttpCode(200)
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new JsonBodyPipe()) body: Record<string, unknown>,
  ) {
    rejectUnknownFields(body, ['expectedRevision', 'proposalId']);
    return this.trips.applyProposal(
      user.userId,
      uuid(id, 'id'),
      revision(body.expectedRevision),
      uuid(body.proposalId, 'proposalId'),
    );
  }
  @Put(':id/schedule')
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new JsonBodyPipe()) body: Record<string, unknown>,
  ) {
    rejectUnknownFields(body, ['expectedRevision', 'days']);
    return this.trips.updateSchedule(
      user.userId,
      uuid(id, 'id'),
      revision(body.expectedRevision),
      scheduleInput(body.days),
    );
  }
}
