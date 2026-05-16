import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';

export interface UploadResult {
  url: string;
  thumbnailUrl?: string;
  key: string;
  width?: number;
  height?: number;
  fileSize: number;
  mimeType: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly s3Client?: S3Client;
  private readonly bucket?: string;
  private readonly cdnUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  )
  {
    const region = this.configService.get<string>('region', 'us-east-1');
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');
    if (!region || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing AWS S3 configuration region.');
    }

    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const bucket = this.configService.get<string>('s3.bucket');
    const cndUrl = this.configService.get<string>('aws.s3.cloudfrontUrl') || this.configService.get<string>('aws.s3.bucketUrl');
    if (!bucket) {
      this.logger.warn('AWS S3 bucket is not configured. File upload operations will be skipped for testing.');
    }
    if (!cndUrl) {
      this.logger.warn('AWS CDN URL is not configured. File URLs will be generated without a CDN prefix.');
    }

    this.bucket = bucket;
    this.cdnUrl = cndUrl || '';
  }

  // ── Upload Single Image ───────────────────────────
  async uploadImage(
    file: Express.Multer.File,
    folder: string,
    generateThumbnail = true,
  ): Promise<UploadResult> {
    if (!file) throw new BadRequestException('No file provided');

    const isImage = file.mimetype.startsWith('image/');
    const key = `${folder}/${uuidv4()}-${Date.now()}`;
    let processedBuffer = file.buffer;
    let width: number | undefined;
    let height: number | undefined;
    let thumbnailUrl: string | undefined;

    // Process image with Sharp
    if (isImage) {
      const image = sharp(file.buffer);
      const metadata = await image.metadata();
      width = metadata.width;
      height = metadata.height;

      // Resize if too large (max 2048px wide)
      if (!width) {throw new Error('Missing width');}
      if (width > 2048) {
        processedBuffer = await image
          .resize(2048, undefined, { withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } else {
        processedBuffer = await image.jpeg({ quality: 85 }).toBuffer();
      }

      // Generate thumbnail
      if (generateThumbnail) {
        const thumbBuffer = await sharp(file.buffer)
          .resize(400, 300, { fit: 'cover' })
          .jpeg({ quality: 75 })
          .toBuffer();

        const thumbKey = `${key}-thumb`;
        await this.uploadToS3(thumbKey, thumbBuffer, 'image/jpeg');
        thumbnailUrl = `${this.cdnUrl}/${thumbKey}`;
      }
    }

    // Upload main file (skip if S3 is not configured)
    await this.uploadToS3(key, processedBuffer, isImage ? 'image/jpeg' : file.mimetype);

    return {
      url: this.cdnUrl ? `${this.cdnUrl}/${key}` : key,
      thumbnailUrl,
      key,
      width,
      height,
      fileSize: processedBuffer.length,
      mimeType: file.mimetype,
    };
  }

  // ── Upload Multiple Images ────────────────────────
  async uploadImages(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<UploadResult[]> {
    if (!files?.length) throw new BadRequestException('No files provided');
    if (files.length > 20) throw new BadRequestException('Maximum 20 files per upload');

    return Promise.all(files.map((f) => this.uploadImage(f, folder)));
  }

  // ── Add Property Images ───────────────────────────
  async addPropertyImages(
    propertyId: string,
    hostId: string,
    files: Express.Multer.File[],
  ) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, hostId },
      include: { images: { select: { id: true }, take: 1 } },
    });
    if (!property) throw new BadRequestException('Property not found');

    const existing = await this.prisma.propertyImage.count({ where: { propertyId } });
    if (existing + files.length > 30) throw new BadRequestException('Maximum 30 images per property');

    const uploads = await this.uploadImages(files, `properties/${propertyId}`);

    const images = await this.prisma.propertyImage.createMany({
      data: uploads.map((upload, i) => ({
        propertyId,
        url: upload.url,
        thumbnailUrl: upload.thumbnailUrl,
        isPrimary: existing === 0 && i === 0,
        sortOrder: existing + i,
        width: upload.width,
        height: upload.height,
        fileSize: upload.fileSize,
      })),
    });

    return { uploaded: uploads.length, images };
  }

  // ── Upload User Avatar ────────────────────────────
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const result = await this.uploadImage(file, `avatars/${userId}`, false);

    // Generate circular-ready avatar (square crop)
    const avatarBuffer = await sharp(file.buffer)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();
    const avatarKey = `avatars/${userId}/avatar`;
    await this.uploadToS3(avatarKey, avatarBuffer, 'image/jpeg');

    const avatarUrl = this.cdnUrl ? `${this.cdnUrl}/${avatarKey}` : avatarKey;
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
    return { avatarUrl };
  }

  // ── Delete File ───────────────────────────────────
  async deleteFile(key: string): Promise<void> {
    if (!this.s3Client || !this.bucket) {
      this.logger.warn(`Skipping deleteFile(${key}) because AWS S3 is not configured.`);
      return;
    }

    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  // ── Presigned URL for direct upload ──────────────
  async getPresignedUploadUrl(
    folder: string,
    mimeType: string,
    expiresIn = 300,
  ) {
    const key = `${folder}/${uuidv4()}-${Date.now()}`;
    if (!this.s3Client || !this.bucket) {
      this.logger.warn(`Skipping presigned URL generation for ${key} because AWS S3 is not configured.`);
      return { url: '', key, expiresIn };
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    const url = await getSignedUrl(this.s3Client, command, { expiresIn });
    return { url, key, expiresIn };
  }

  // ── Reorder Property Images ───────────────────────
  async reorderImages(propertyId: string, hostId: string, imageOrder: string[]) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, hostId } });
    if (!property) throw new BadRequestException('Not authorized');

    await Promise.all(
      imageOrder.map((imageId, index) =>
        this.prisma.propertyImage.update({
          where: { id: imageId },
          data: { sortOrder: index, isPrimary: index === 0 },
        }),
      ),
    );
    return { success: true };
  }

  // ── Set Primary Image ─────────────────────────────
  async setPrimaryImage(propertyId: string, hostId: string, imageId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, hostId } });
    if (!property) throw new BadRequestException('Not authorized');

    await this.prisma.$transaction([
      this.prisma.propertyImage.updateMany({
        where: { propertyId },
        data: { isPrimary: false },
      }),
      this.prisma.propertyImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);
    return { success: true };
  }

  // ── Delete Property Image ─────────────────────────
  async deletePropertyImage(propertyId: string, hostId: string, imageId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, hostId } });
    if (!property) throw new BadRequestException('Not authorized');

    const image = await this.prisma.propertyImage.findUnique({ where: { id: imageId } });
    if (!image || image.propertyId !== propertyId) throw new BadRequestException('Image not found');

    // Delete from S3 (extract key from URL)
    const key = image.url.replace(`${this.cdnUrl}/`, '');
    await this.deleteFile(key).catch(() => {});
    if (image.thumbnailUrl) {
      const thumbKey = image.thumbnailUrl.replace(`${this.cdnUrl}/`, '');
      await this.deleteFile(thumbKey).catch(() => {});
    }

    await this.prisma.propertyImage.delete({ where: { id: imageId } });
    return { deleted: true };
  }

  // ── Private S3 Helper ─────────────────────────────
  private async uploadToS3(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    if (!this.s3Client || !this.bucket) {
      this.logger.warn(`Skipping uploadToS3(${key}) because AWS S3 is not configured.`);
      return;
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000',
      }),
    );
  }
}
