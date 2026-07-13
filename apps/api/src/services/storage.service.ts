import { Client as MinioClient } from 'minio';
import type { Readable } from 'node:stream';
import { config } from '../config/index.js';

export interface UploadOptions {
  bucket?: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

/**
 * S3-compatible object storage (MinIO in dev, any S3 endpoint in prod).
 * Pure infrastructure — callers decide bucket layout and object semantics.
 */
export class StorageService {
  private readonly client: MinioClient;
  private readonly defaultBucket: string;

  constructor() {
    this.client = new MinioClient({
      endPoint: config.storage.endpoint,
      port: config.storage.port,
      useSSL: config.storage.useSSL,
      accessKey: config.storage.accessKey,
      secretKey: config.storage.secretKey,
    });
    this.defaultBucket = config.storage.defaultBucket;
  }

  /** Create the default bucket if it does not exist. Called at boot. */
  async ensureDefaultBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.defaultBucket);
    if (!exists) await this.client.makeBucket(this.defaultBucket);
  }

  async upload(
    key: string,
    data: Buffer | Readable,
    options: UploadOptions = {},
  ): Promise<{ bucket: string; key: string; etag: string }> {
    const bucket = options.bucket ?? this.defaultBucket;
    const meta = {
      ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
      ...options.metadata,
    };
    const result = Buffer.isBuffer(data)
      ? await this.client.putObject(bucket, key, data, data.length, meta)
      : await this.client.putObject(bucket, key, data, undefined, meta);
    return { bucket, key, etag: result.etag };
  }

  async download(key: string, bucket = this.defaultBucket): Promise<Readable> {
    return this.client.getObject(bucket, key);
  }

  async delete(key: string, bucket = this.defaultBucket): Promise<void> {
    await this.client.removeObject(bucket, key);
  }

  /** Presigned GET url; default expiry 1 hour. */
  async getSignedUrl(
    key: string,
    expirySeconds = 3600,
    bucket = this.defaultBucket,
  ): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expirySeconds);
  }

  async health(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.defaultBucket);
      return true;
    } catch {
      return false;
    }
  }
}
