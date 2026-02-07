export const MAX_DRIVE_FILENAME_LENGTH = 80;
export const MAX_DRIVE_PAYLOAD_BYTES = 512_000;

export class PayloadLimitError extends Error {
  readonly limitBytes: number;
  readonly actualBytes: number;
  readonly label: string;

  constructor(label: string, actualBytes: number, limitBytes = MAX_DRIVE_PAYLOAD_BYTES) {
    super(`${label} exceeds ${limitBytes} bytes.`);
    this.name = 'PayloadLimitError';
    this.limitBytes = limitBytes;
    this.actualBytes = actualBytes;
    this.label = label;
  }
}

export class OutsideFolderError extends Error {
  readonly fileId: string;

  constructor(fileId: string) {
    super('File is outside the provisioned folder.');
    this.name = 'OutsideFolderError';
    this.fileId = fileId;
  }
}

export const sanitizeDriveFileName = (value: string, fallback: string) => {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, '').trim();
  const truncated = sanitized.slice(0, MAX_DRIVE_FILENAME_LENGTH);
  return truncated || fallback;
};

export const assertPayloadWithinLimit = (payload: string, label: string) => {
  const size = Buffer.byteLength(payload, 'utf8');
  if (size > MAX_DRIVE_PAYLOAD_BYTES) {
    throw new PayloadLimitError(label, size);
  }
};
