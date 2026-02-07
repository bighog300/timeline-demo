import type { drive_v3 } from 'googleapis';
import { describe, expect, it, vi } from 'vitest';

import { fetchDriveFileText } from './fetchSourceText';

const createDriveMock = () =>
  ({
    files: {
      get: vi.fn(),
      copy: vi.fn(),
      export: vi.fn(),
      delete: vi.fn(),
    },
  }) as unknown as drive_v3.Drive;

describe('fetchDriveFileText (PDF)', () => {
  it('uses OCR conversion and cleans up the temporary doc by default', async () => {
    const drive = createDriveMock();
    drive.files.get = vi.fn().mockResolvedValue({
      data: {
        id: 'pdf-1',
        name: 'Report',
        mimeType: 'application/pdf',
        modifiedTime: '2024-01-01T00:00:00Z',
        webViewLink: 'https://drive.test/file',
        size: '1024',
      },
    });
    drive.files.copy = vi.fn().mockResolvedValue({ data: { id: 'ocr-doc-1' } });
    drive.files.export = vi.fn().mockResolvedValue({ data: 'Extracted text' });
    drive.files.delete = vi.fn().mockResolvedValue({});

    const result = await fetchDriveFileText(drive, 'pdf-1', 'folder-1');

    expect(result.text).toBe('Extracted text');
    expect(drive.files.copy).toHaveBeenCalled();
    expect(drive.files.export).toHaveBeenCalledWith(
      { fileId: 'ocr-doc-1', mimeType: 'text/plain' },
      expect.any(Object),
    );
    expect(drive.files.delete).toHaveBeenCalledWith({ fileId: 'ocr-doc-1' }, expect.any(Object));
  });

  it('falls back to a placeholder when OCR fails', async () => {
    const drive = createDriveMock();
    drive.files.get = vi.fn().mockResolvedValue({
      data: {
        id: 'pdf-2',
        name: 'Broken PDF',
        mimeType: 'application/pdf',
        modifiedTime: '2024-01-01T00:00:00Z',
        webViewLink: 'https://drive.test/file',
        size: '2048',
      },
    });
    drive.files.copy = vi.fn().mockRejectedValue(new Error('copy failed'));

    const result = await fetchDriveFileText(drive, 'pdf-2', 'folder-1');

    expect(result.text).toContain('Could not extract text via OCR');
    expect(result.text).toContain('Unsupported for text extraction');
  });

  it('returns a too_large placeholder when the PDF exceeds the limit', async () => {
    const drive = createDriveMock();
    drive.files.get = vi.fn().mockResolvedValue({
      data: {
        id: 'pdf-3',
        name: 'Huge PDF',
        mimeType: 'application/pdf',
        modifiedTime: '2024-01-01T00:00:00Z',
        webViewLink: 'https://drive.test/file',
        size: String(25 * 1024 * 1024),
      },
    });
    drive.files.copy = vi.fn();

    const result = await fetchDriveFileText(drive, 'pdf-3', 'folder-1');

    expect(result.text).toContain('too_large');
    expect(drive.files.copy).not.toHaveBeenCalled();
  });
});
