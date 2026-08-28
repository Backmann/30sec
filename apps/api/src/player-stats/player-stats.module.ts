import { Global, Module } from '@nestjs/common';
import { PlayerStatsService } from './player-stats.service';

/**
 * Global like PrismaModule: several modules need stat recalculation and making
 * it global avoids importing it into each one (and avoids circular imports
 * between tournaments and judgements).
 */
@Global()
@Module({
  providers: [PlayerStatsService],
  exports: [PlayerStatsService],
})
export class PlayerStatsModule {}
