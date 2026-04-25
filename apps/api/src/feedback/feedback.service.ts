import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto, UpdateFeedbackDto } from './feedback.dto';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateFeedbackDto, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    const fb = await this.prisma.feedback.create({
      data: {
        userId: ctx.userId || null,
        category: dto.category,
        subject: dto.subject,
        message: dto.message,
        email: dto.email || null,
        url: dto.url || null,
        userAgent: ctx.userAgent || null,
        ipAddress: ctx.ipAddress || null,
      },
    });
    this.logger.log(`New feedback: ${fb.id} (${fb.category})`);
    return { id: fb.id, status: 'received' };
  }

  async listAdmin(params: { status?: string; category?: string; limit?: number; offset?: number }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, profile: { select: { nickname: true, avatarUrl: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: params.limit || 50,
        skip: params.offset || 0,
      }),
      this.prisma.feedback.count({ where }),
    ]);

    return { items, total };
  }

  async getStats() {
    const groupByStatus = await this.prisma.feedback.groupBy({
      by: ['status'],
      _count: true,
    });
    const groupByCategory = await this.prisma.feedback.groupBy({
      by: ['category'],
      _count: true,
    });
    const total = await this.prisma.feedback.count();
    const newCount = await this.prisma.feedback.count({ where: { status: 'new' } });

    return {
      total,
      newCount,
      byStatus: Object.fromEntries(groupByStatus.map(g => [g.status, g._count])),
      byCategory: Object.fromEntries(groupByCategory.map(g => [g.category, g._count])),
    };
  }

  async update(id: string, dto: UpdateFeedbackDto) {
    const exists = await this.prisma.feedback.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Feedback не найден');

    return this.prisma.feedback.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.adminNotes !== undefined ? { adminNotes: dto.adminNotes } : {}),
      },
    });
  }
}
