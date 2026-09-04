/**
 * Cloudflare R2 storage helper shared by the api/storage/* Vercel functions.
 * Bucket is private — every read/write goes through a short-lived presigned
 * URL minted here with the account's R2 access key/secret.
 *
 * Mirrors backend/services/r2StorageService.js (the same logic for the local
 * Express dev server), since Vercel deploys api/**\/*.js as serverless
 * functions and never runs backend/server.js in production.
 *
 * DEPLOYED COPY: the Vercel project's Root Directory is set to `frontend`,
 * so only frontend/api/** is ever built into functions — the sibling
 * ../../api/_lib/r2Client.js at the repo root is never deployed. This file
 * must stay in sync with it (or Root Directory should be changed to the
 * repo root and this copy retired) until that setting is fixed.
 */

import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.R2_BUCKET_NAME;

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const UPLOAD_URL_EXPIRY_SECONDS = 300; // 5 minutes to complete the PUT
const DOWNLOAD_URL_EXPIRY_SECONDS = 518400; // 6 days — under the 7-day SigV4 cap

const sanitizeFilename = (filename = 'file') =>
  filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);

export const buildKey = (folder, userId, filename) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `${folder}/${userId}/${timestamp}-${random}-${sanitizeFilename(filename)}`;
};

export const getUploadUrl = async ({ key, contentType, expiresIn = UPLOAD_URL_EXPIRY_SECONDS }) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(s3Client, command, { expiresIn });
};

export const getDownloadUrl = async ({ key, expiresIn = DOWNLOAD_URL_EXPIRY_SECONDS }) => {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
};

export const deleteObject = async ({ key }) => {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};
