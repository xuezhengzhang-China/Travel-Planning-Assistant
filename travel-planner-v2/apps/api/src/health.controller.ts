import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Controller()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'travel-planner-api' } as const;
  }

  @Get('ready')
  async ready() {
    if (!(await this.database.isReady())) {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'not-ready' });
    }
    return { status: 'ready', database: 'ok' } as const;
  }
}
