import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async getAll(@Request() req, @Query('page') page?: string) {
    return this.notificationsService.getAll(req.user.sub, page ? parseInt(page) : 1);
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread')
  async getUnread(@Request() req) {
    return this.notificationsService.getUnread(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async getUnreadCount(@Request() req) {
    const count = await this.notificationsService.countUnread(req.user.sub);
    return { count };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/read')
  async markAsRead(@Request() req, @Param('id') id: string) {
    await this.notificationsService.markAsRead(req.user.sub, id);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('read-all')
  async markAllAsRead(@Request() req) {
    await this.notificationsService.markAllAsRead(req.user.sub);
    return { success: true };
  }
}
