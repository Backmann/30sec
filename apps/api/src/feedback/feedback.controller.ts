import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto, UpdateFeedbackDto } from './feedback.dto';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  // Public — anyone can submit, but if logged in we attach user
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  async create(@Body() dto: CreateFeedbackDto, @Req() req: Request) {
    const userId = (req as any).user?.sub;
    const ip = (req.headers['cf-connecting-ip'] as string)
      || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || (req.headers['x-real-ip'] as string)
      || req.ip;
    const ua = req.headers['user-agent'] || undefined;
    return this.feedback.create(dto, { userId, ipAddress: ip, userAgent: ua });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin')
  list(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.feedback.listAdmin({
      status,
      category,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/stats')
  stats() {
    return this.feedback.getStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch('admin/:id')
  update(@Param('id') id: string, @Body() dto: UpdateFeedbackDto) {
    return this.feedback.update(id, dto);
  }
}
