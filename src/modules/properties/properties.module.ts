import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { FilesModule } from '../files/files.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [FilesModule, SearchModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
