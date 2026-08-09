import { S3Client } from "@aws-sdk/client-s3";

/**
 * Shared client + bucket name for project-file storage (S3, replacing
 * Vercel Blob — see save_project_file.ts/list_project_files.ts/
 * get_project_file.ts). Credentials come from the ECS task role, same as
 * every other AWS SDK call in this app; no access key ever lives in env.
 */
export const s3 = new S3Client({});

export function projectFilesBucket(): string {
  const bucket = process.env.PROJECT_FILES_BUCKET;
  if (!bucket) {
    throw new Error("PROJECT_FILES_BUCKET is not set.");
  }
  return bucket;
}
