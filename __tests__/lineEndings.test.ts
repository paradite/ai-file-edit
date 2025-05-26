import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  getPlatformLineEnding,
  detectLineEnding,
  normalizeLineEndings,
  applyPlatformLineEndings,
  applyFileEdits,
} from '../utils/fileUtils.js';

describe('Line Ending Utilities', () => {
  describe('getPlatformLineEnding', () => {
    test('should return correct line ending for current platform', () => {
      const expected = os.platform() === 'win32' ? '\r\n' : '\n';
      expect(getPlatformLineEnding()).toBe(expected);
    });
  });

  describe('detectLineEnding', () => {
    test('should detect Windows line endings', () => {
      const text = 'line1\r\nline2\r\nline3';
      expect(detectLineEnding(text)).toBe('\r\n');
    });

    test('should detect Unix line endings', () => {
      const text = 'line1\nline2\nline3';
      expect(detectLineEnding(text)).toBe('\n');
    });

    test('should detect Windows line endings when mixed', () => {
      const text = 'line1\r\nline2\nline3\r\n';
      expect(detectLineEnding(text)).toBe('\r\n');
    });

    test('should return platform line ending for text without line endings', () => {
      const text = 'single line';
      const expected = os.platform() === 'win32' ? '\r\n' : '\n';
      expect(detectLineEnding(text)).toBe(expected);
    });
  });

  describe('normalizeLineEndings', () => {
    test('should convert Windows line endings to Unix', () => {
      const text = 'line1\r\nline2\r\nline3';
      expect(normalizeLineEndings(text)).toBe('line1\nline2\nline3');
    });

    test('should leave Unix line endings unchanged', () => {
      const text = 'line1\nline2\nline3';
      expect(normalizeLineEndings(text)).toBe('line1\nline2\nline3');
    });

    test('should handle mixed line endings', () => {
      const text = 'line1\r\nline2\nline3\r\n';
      expect(normalizeLineEndings(text)).toBe('line1\nline2\nline3\n');
    });
  });

  describe('applyPlatformLineEndings', () => {
    test('should apply Windows line endings when specified', () => {
      const text = 'line1\nline2\nline3';
      expect(applyPlatformLineEndings(text, '\r\n')).toBe('line1\r\nline2\r\nline3');
    });

    test('should apply Unix line endings when specified', () => {
      const text = 'line1\nline2\nline3';
      expect(applyPlatformLineEndings(text, '\n')).toBe('line1\nline2\nline3');
    });

    test('should apply platform line endings when not specified', () => {
      const text = 'line1\nline2\nline3';
      const expected =
        os.platform() === 'win32' ? 'line1\r\nline2\r\nline3' : 'line1\nline2\nline3';
      expect(applyPlatformLineEndings(text)).toBe(expected);
    });

    test('should handle text with existing Windows line endings', () => {
      const text = 'line1\r\nline2\r\nline3';
      expect(applyPlatformLineEndings(text, '\n')).toBe('line1\nline2\nline3');
    });
  });
});

describe('File Operations with Line Endings', () => {
  const testDir = path.join(process.cwd(), 'test-line-endings');

  beforeEach(async () => {
    await fs.mkdir(testDir, {recursive: true});
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, {recursive: true});
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('applyFileEdits with line endings', () => {
    test('should preserve original line endings when editing existing file', async () => {
      const testFilePath = path.join(testDir, 'test-preserve-endings.txt');
      const originalContent = 'Hello, World!\r\nThis is a test.\r\nGoodbye!';

      // Create file with Windows line endings
      await fs.writeFile(testFilePath, originalContent, 'utf-8');

      const edits = [
        {
          oldText: 'Hello, World!',
          newText: 'Hello, Universe!',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.validEdits).toBe(true);

      // Read the file and check that Windows line endings are preserved
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('Hello, Universe!\r\nThis is a test.\r\nGoodbye!');
      expect(fileContent.includes('\r\n')).toBe(true);
    });

    test('should use platform line endings for new files', async () => {
      const testFilePath = path.join(testDir, 'test-new-file.txt');
      const content = 'Line 1\nLine 2\nLine 3';

      const result = await applyFileEdits(testDir, testFilePath, undefined, content);

      expect(result.newFileCreated).toBe(true);

      // Read the file and check line endings
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      const expectedLineEnding = os.platform() === 'win32' ? '\r\n' : '\n';
      const expectedContent = content.replace(/\n/g, expectedLineEnding);
      expect(fileContent).toBe(expectedContent);
    });

    test('should handle Unix line endings in existing file', async () => {
      const testFilePath = path.join(testDir, 'test-unix-endings.txt');
      const originalContent = 'Hello, World!\nThis is a test.\nGoodbye!';

      // Create file with Unix line endings
      await fs.writeFile(testFilePath, originalContent, 'utf-8');

      const edits = [
        {
          oldText: 'Hello, World!',
          newText: 'Hello, Universe!',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.validEdits).toBe(true);

      // Read the file and check that Unix line endings are preserved
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('Hello, Universe!\nThis is a test.\nGoodbye!');
      expect(fileContent.includes('\r\n')).toBe(false);
    });

    test('should handle mixed line endings by preserving the first detected type', async () => {
      const testFilePath = path.join(testDir, 'test-mixed-endings.txt');
      // Start with Windows line ending, so it should be detected as Windows
      const originalContent = 'Hello, World!\r\nThis is a test.\nGoodbye!\r\n';

      await fs.writeFile(testFilePath, originalContent, 'utf-8');

      const edits = [
        {
          oldText: 'Hello, World!',
          newText: 'Hello, Universe!',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.validEdits).toBe(true);

      // Read the file and check that Windows line endings are used throughout
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('Hello, Universe!\r\nThis is a test.\r\nGoodbye!\r\n');
    });

    test('should handle content parameter with different line endings', async () => {
      const testFilePath = path.join(testDir, 'test-content-endings.txt');
      const originalContent = 'Original content\r\nwith Windows endings';

      // Create file with Windows line endings
      await fs.writeFile(testFilePath, originalContent, 'utf-8');

      // Provide new content with Unix line endings
      const newContent = 'New content\nwith Unix endings\nand more lines';

      const result = await applyFileEdits(testDir, testFilePath, undefined, newContent);

      expect(result.validEdits).toBe(true);

      // Read the file and check that original line ending style is preserved
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('New content\r\nwith Unix endings\r\nand more lines');
    });
  });

  // Platform-specific tests
  if (os.platform() === 'win32') {
    describe('Windows-specific line ending tests', () => {
      test('should use CRLF for new files on Windows', async () => {
        const testFilePath = path.join(testDir, 'test-windows-new.txt');
        const content = 'Line 1\nLine 2\nLine 3';

        const result = await applyFileEdits(testDir, testFilePath, undefined, content);

        expect(result.newFileCreated).toBe(true);

        const fileContent = await fs.readFile(testFilePath, 'utf-8');
        expect(fileContent).toBe('Line 1\r\nLine 2\r\nLine 3');
        expect(fileContent.includes('\r\n')).toBe(true);
      });
    });
  } else {
    describe('Unix-like platform line ending tests', () => {
      test('should use LF for new files on Unix-like systems', async () => {
        const testFilePath = path.join(testDir, 'test-unix-new.txt');
        const content = 'Line 1\nLine 2\nLine 3';

        const result = await applyFileEdits(testDir, testFilePath, undefined, content);

        expect(result.newFileCreated).toBe(true);

        const fileContent = await fs.readFile(testFilePath, 'utf-8');
        expect(fileContent).toBe('Line 1\nLine 2\nLine 3');
        expect(fileContent.includes('\r\n')).toBe(false);
      });
    });
  }
});
