import { Controller, Post, Body, UseGuards, BadRequestException, Delete, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UploadsService } from './uploads.service';

@Controller('uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presigned')
  async getPresigned(@Body() body: { category: 'question' | 'answer'; contentType: string; contentLength?: number }) {
    if (!body?.category || !['question', 'answer'].includes(body.category)) {
      throw new BadRequestException('category должен быть "question" или "answer"');
    }
    if (!body?.contentType) throw new BadRequestException('contentType обязателен');
    return this.uploads.getPresignedUploadUrl(body);
  }

  @Delete(':key')
  async delete(@Param('key') key: string) {
    return this.uploads.deleteObject(decodeURIComponent(key));
  }
}
