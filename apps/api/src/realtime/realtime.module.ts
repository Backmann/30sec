import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { GameGateway } from './game.gateway';
import { RealtimeService } from './realtime.service';
import { GameStateStore } from './game-state.store';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, JwtModule.register({}), ConfigModule],
  providers: [GameGateway, RealtimeService, GameStateStore],
  exports: [RealtimeService, GameGateway],
})
export class RealtimeModule {}
