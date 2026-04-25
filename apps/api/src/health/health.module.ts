import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PublicHealthController } from './public-health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController, PublicHealthController],
  providers: [HealthService],
})
export class HealthModule {}
