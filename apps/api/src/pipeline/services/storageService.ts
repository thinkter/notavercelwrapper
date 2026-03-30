import { env } from "../../env";

function requireR2Config(): {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
} {
  const required = {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
  };

  if (
    !required.accessKeyId ||
    !required.secretAccessKey ||
    !required.bucketName ||
    !required.endpoint
  ) {
    throw new Error("R2 configuration is incomplete");
  }

  return {
    accessKeyId: required.accessKeyId,
    secretAccessKey: required.secretAccessKey,
    bucketName: required.bucketName,
    endpoint: required.endpoint,
  };
}

type S3PutObjectInput = {
  Bucket: string;
  Key: string;
  Body: ReadableStream;
};

type S3PutObjectLike = {
  putObject?: (input: S3PutObjectInput) => Promise<unknown>;
};

const s3 = new Bun.S3Client({
  accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
  secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
  endpoint: env.R2_ENDPOINT,
  region: "auto",
  bucket: env.R2_BUCKET_NAME ?? "",
});

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildObjectUrl(key: string): string {
  const config = requireR2Config();
  const normalizedEndpoint = config.endpoint.replace(/\/+$/, "");
  return `${normalizedEndpoint}/${config.bucketName}/${encodeObjectKey(key)}`;
}

export async function uploadToR2(filePath: string, key: string): Promise<string> {
  const config = requireR2Config();
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new Error(`Artifact file does not exist: ${filePath}`);
  }

  const fileStream = file.stream();
  const dynamicClient = s3 as unknown as S3PutObjectLike;

  if (dynamicClient.putObject) {
    await dynamicClient.putObject({
      Bucket: config.bucketName,
      Key: key,
      Body: fileStream,
    });
  } else {
    await s3.write(key, file, {
      bucket: config.bucketName,
      type: "application/x-tar",
    });
  }

  return buildObjectUrl(key);
}

export async function isObjectPubliclyAccessible(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
    });

    return response.ok;
  } catch {
    return false;
  }
}
