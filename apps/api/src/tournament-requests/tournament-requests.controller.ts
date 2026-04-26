import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../common/guards/email-verified.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TournamentRequestsService } from './tournament-requests.service';
import {
  AdminListQueryDto,
  CreateTournamentRequestDto,
  FulfillRequestsDto,
} from './tournament-requests.dto';

@Controller('tournament-requests')
export class TournamentRequestsController {
  constructor(private readonly svc: TournamentRequestsService) {}

  // ---------- User endpoints ----------

  /**
   * Sign up for a future tournament. Requires verified email.
   */
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  @Post()
  create(@Body() dto: CreateTournamentRequestDto, @Req() req: Request) {
    const userId = (req as any).user.sub;
    return this.svc.create(userId, dto);
  }

  /**
   * Withdraw own request.
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  withdraw(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user.sub;
    return this.svc.withdrawOwn(userId, id);
  }

  /**
   * My active requests across all languages.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(@Req() req: Request) {
    const userId = (req as any).user.sub;
    return this.svc.listMine(userId);
  }

  /**
   * Bucketed public counts (anti-shaming for tiny queues).
   * No auth — used on landing page.
   */
  @Get('stats/public')
  publicStats() {
    return this.svc.publicStats();
  }

  // ---------- Admin endpoints ----------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/overview')
  adminOverview() {
    return this.svc.adminOverview();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/list')
  adminList(
    @Query() filter: AdminListQueryDto,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.adminList({
      language: filter.language,
      status: filter.status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch('admin/fulfill')
  fulfill(@Body() dto: FulfillRequestsDto) {
    return this.svc.fulfillRequests(dto);
  }
}
