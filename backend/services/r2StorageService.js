/**
 * Cloudflare R2 storage service (S3-compatible API).
 * Bucket is private — every read/write goes through a short-lived presigned
 * URL minted here with the account's R2 access key/secret. Never expose
 * those credentials to the frontend; only signed URLs leave this process.
 */

const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

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

const buildKey = (folder, userId, filename) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `${folder}/${userId}/${timestamp}-${random}-${sanitizeFilename(filename)}`;
};

const getUploadUrl = async ({ key, contentType, expiresIn = UPLOAD_URL_EXPIRY_SECONDS }) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(s3Client, command, { expiresIn });
};

const getDownloadUrl = async ({ key, expiresIn = DOWNLOAD_URL_EXPIRY_SECONDS, filename }) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    // Only set when the caller wants a forced "Save As" download (e.g. a
    // chat attachment's Download button) — R2/S3 honors this regardless of
    // cross-origin, unlike an <a download> attribute, which browsers ignore
    // for a cross-origin href. Omitted for every other caller (image/video
    // preview resolution etc.) so those keep displaying inline as today.
    ...(filename ? { ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"` } : {}),
  });
  return getSignedUrl(s3Client, command, { expiresIn });
};

const deleteObject = async ({ key }) => {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

module.exports = {
  buildKey,
  getUploadUrl,
  getDownloadUrl,
  deleteObject,
};
