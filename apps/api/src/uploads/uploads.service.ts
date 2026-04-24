import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class UploadsService {
  private s3: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private config: ConfigService) {
    this.bucket = config.get<string>('R2_BUCKET') || '';
    this.publicUrl = config.get<string>('R2_PUBLIC_URL') || '';
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: config.get<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: config.get<string>('R2_ACCESS_KEY_ID') || '',
        secretAccessKey: config.get<string>('R2_SECRET_ACCESS_KEY') || '',
      },
    });
  }

  // Generate presigned PUT URL — client uploads directly to R2
  async getPresignedUploadUrl(params: {
    category: 'question' | 'answer' | 'avatar';
    contentType: string;
    contentLength?: number;
  }) {
    if (!ALLOWED_MIME.includes(params.contentType)) {
      throw new BadRequestException(`Неподдерживаемый формат. Разрешены: ${ALLOWED_MIME.join(', ')}`);
    }
    if (params.contentLength && params.contentLength > MAX_SIZE_BYTES) {
      throw new BadRequestException(`Файл слишком большой. Максимум ${MAX_SIZE_BYTES / 1024 / 1024} MB.`);
    }

    const ext = params.contentType.split('/')[1] === 'jpeg' ? 'jpg' : params.contentType.split('/')[1];
    const key = `${params.category}s/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: params.contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 300 }); // 5 min
    const publicUrl = `${this.publicUrl}/${key}`;

    return { uploadUrl, publicUrl, key };
  }

  // Delete object from bucket
  async deleteObject(key: string) {
    const cmd = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.s3.send(cmd);
    return { deleted: true, key };
  }

  // Extract R2 key from full public URL
  extractKey(url: string): string | null {
    if (!url || !this.publicUrl) return null;
    if (!url.startsWith(this.publicUrl)) return null;
    return url.slice(this.publicUrl.length + 1); // +1 for leading slash
  }
}
