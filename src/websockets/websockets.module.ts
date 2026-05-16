import { Global, Module } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { AuthModule } from '@modules/auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class WebsocketsModule {}
