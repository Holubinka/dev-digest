/**
 * Build a `multipart/form-data` body by hand.
 *
 * Hand-rolled rather than driving a global `FormData` through light-my-request:
 * this is deterministic, adds no dependency, and exercises the same parser a
 * browser upload reaches.
 */
export function multipartBody(
  files: Array<{
    field: string;
    filename: string;
    content: Buffer | Uint8Array | string;
    contentType?: string;
  }>,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----devdigesttestboundary0123456789';
  const parts: Buffer[] = [];

  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      Buffer.from(file.content as Uint8Array),
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
