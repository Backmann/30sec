import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { HealthService } from './health.service';

@Controller('admin/health')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  get() {
    return this.health.getSystemHealth();
  }
}
