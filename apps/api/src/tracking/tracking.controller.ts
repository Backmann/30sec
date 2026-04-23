import { Controller, Post, UseGuards, Request } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  @Post('ping')
  async ping(@Request() req) {
    await this.tracking.trackActivity(req.user.sub, req);
    return { tracked: true };
  }
}
