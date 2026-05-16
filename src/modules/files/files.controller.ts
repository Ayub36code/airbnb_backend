import {
  Controller, Post, Delete, Patch, Param, Body,
  UploadedFile, UploadedFiles, UseInterceptors,
  ParseUUIDPipe, Get, Query,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Files')
@ApiBearerAuth('JWT')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload user avatar' })
  uploadAvatar(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    return this.filesService.uploadAvatar(user.id, file);
  }

  @Post('properties/:propertyId/images')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('files', 20))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload property images (up to 20)' })
  uploadPropertyImages(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.filesService.addPropertyImages(propertyId, user.id, files);
  }

  @Patch('properties/:propertyId/images/reorder')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Reorder property images' })
  reorderImages(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: any,
    @Body('imageOrder') imageOrder: string[],
  ) {
    return this.filesService.reorderImages(propertyId, user.id, imageOrder);
  }

  @Patch('properties/:propertyId/images/:imageId/primary')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Set primary property image' })
  setPrimaryImage(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: any,
  ) {
    return this.filesService.setPrimaryImage(propertyId, user.id, imageId);
  }

  @Delete('properties/:propertyId/images/:imageId')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a property image' })
  deleteImage(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: any,
  ) {
    return this.filesService.deletePropertyImage(propertyId, user.id, imageId);
  }

  @Get('presign')
  @ApiOperation({ summary: 'Get presigned URL for direct S3 upload' })
  getPresignedUrl(
    @Query('folder') folder: string,
    @Query('mimeType') mimeType: string,
  ) {
    return this.filesService.getPresignedUploadUrl(folder, mimeType);
  }
}
