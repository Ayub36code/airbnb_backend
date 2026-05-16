// admin.module.ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { FraudService } from './fraud.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, FraudService],
  exports: [AdminService, FraudService],
})
export class AdminModule {}
