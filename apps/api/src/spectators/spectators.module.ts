import { Module } from '@nestjs/common';
import { SpectatorsController } from './spectators.controller';
import { SpectatorsService } from './spectators.service';

@Module({
  controllers: [SpectatorsController],
  providers: [SpectatorsService],
  exports: [SpectatorsService],
})
export class SpectatorsModule {}
