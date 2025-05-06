import {applyFileEdits} from '../utils/fileUtils';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('applyFileEdits', () => {
  const testDir = path.join(process.cwd(), 'sample-file-edits');
  const testFilePath = path.join(testDir, 'test.txt');

  beforeAll(async () => {
    // Create test directory and ensure it's clean
    await fs.rm(testDir, {recursive: true, force: true});
    await fs.mkdir(testDir, {recursive: true});
  });

  afterAll(async () => {
    // Clean up test directory
    await fs.rm(testDir, {recursive: true, force: true});
  });

  beforeEach(async () => {
    // Clean up test file before each test
    try {
      await fs.unlink(testFilePath);
    } catch (error) {
      // Ignore errors if file doesn't exist
    }
  });

  describe('file creation', () => {
    test('should create new file with content', async () => {
      const content = 'Hello, World!';
      const result = await applyFileEdits(testDir, testFilePath, undefined, content);

      expect(result.newFileCreated).toBe(true);
      expect(result.fileExists).toBe(false);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully created file');

      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe(content);
    });

    test('should create new file with relative path with ./ prefix', async () => {
      const relativePath = './relative-test.txt';
      const content = 'Hello from relative path with ./ prefix!';
      const result = await applyFileEdits(testDir, relativePath, undefined, content);

      expect(result.newFileCreated).toBe(true);
      expect(result.fileExists).toBe(false);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully created file');

      const fileContent = await fs.readFile(path.join(testDir, 'relative-test.txt'), 'utf-8');
      expect(fileContent).toBe(content);
    });

    test('should create new file with relative path without ./ prefix', async () => {
      const relativePath = 'relative-test-no-prefix.txt';
      const content = 'Hello from relative path without ./ prefix!';
      const result = await applyFileEdits(testDir, relativePath, undefined, content);

      expect(result.newFileCreated).toBe(true);
      expect(result.fileExists).toBe(false);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully created file');

      const fileContent = await fs.readFile(
        path.join(testDir, 'relative-test-no-prefix.txt'),
        'utf-8',
      );
      expect(fileContent).toBe(content);
    });
  });

  describe('file updates', () => {
    test('should update existing file with content', async () => {
      // Create initial file
      const initialContent = 'Initial content';
      await fs.writeFile(testFilePath, initialContent);

      const newContent = 'Updated content';
      const result = await applyFileEdits(testDir, testFilePath, undefined, newContent);

      expect(result.newFileCreated).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully updated file');

      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe(newContent);
    });

    test('should update existing file with relative path with ./ prefix', async () => {
      const relativePath = './relative-test.txt';
      const initialContent = 'Initial content with ./ prefix';
      await fs.writeFile(path.join(testDir, 'relative-test.txt'), initialContent);

      const newContent = 'Updated content with ./ prefix';
      const result = await applyFileEdits(testDir, relativePath, undefined, newContent);

      expect(result.newFileCreated).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully updated file');

      const fileContent = await fs.readFile(path.join(testDir, 'relative-test.txt'), 'utf-8');
      expect(fileContent).toBe(newContent);
    });

    test('should update existing file with relative path without ./ prefix', async () => {
      const relativePath = 'relative-test-no-prefix.txt';
      const initialContent = 'Initial content without ./ prefix';
      await fs.writeFile(path.join(testDir, 'relative-test-no-prefix.txt'), initialContent);

      const newContent = 'Updated content without ./ prefix';
      const result = await applyFileEdits(testDir, relativePath, undefined, newContent);

      expect(result.newFileCreated).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully updated file');

      const fileContent = await fs.readFile(
        path.join(testDir, 'relative-test-no-prefix.txt'),
        'utf-8',
      );
      expect(fileContent).toBe(newContent);
    });
  });

  describe('file edits', () => {
    test('should apply single edit to existing file', async () => {
      // Create initial file
      const initialContent = 'Hello, World!\nThis is a test.';
      await fs.writeFile(testFilePath, initialContent);

      const edits = [
        {
          oldText: 'Hello, World!',
          newText: 'Hello, Universe!',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.newFileCreated).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully updated file');

      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('Hello, Universe!\nThis is a test.');
    });

    test('should apply multiple edits to existing file', async () => {
      // Create initial file
      const initialContent = 'Hello, World!\nThis is a test.\nGoodbye, World!';
      await fs.writeFile(testFilePath, initialContent);

      const edits = [
        {
          oldText: 'Hello, World!',
          newText: 'Hello, Universe!',
        },
        {
          oldText: 'Goodbye, World!',
          newText: 'Goodbye, Universe!',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.newFileCreated).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.validEdits).toBe(true);
      expect(result.response).toContain('Successfully updated file');

      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('Hello, Universe!\nThis is a test.\nGoodbye, Universe!');
    });

    test('should handle whitespace in edits', async () => {
      // Create initial file
      const initialContent = '  Hello, World!  \n  This is a test.  ';
      await fs.writeFile(testFilePath, initialContent);

      const edits = [
        {
          oldText: 'Hello, World!',
          newText: 'Hello, Universe!',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.newFileCreated).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.validEdits).toBe(true);

      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('  Hello, Universe!  \n  This is a test.  ');
    });

    test('should return error when edit cannot be found', async () => {
      // Create initial file
      const initialContent = 'Hello, World!';
      await fs.writeFile(testFilePath, initialContent);

      const edits = [
        {
          oldText: 'Non-existent text',
          newText: 'New text',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.validEdits).toBe(false);
      expect(result.response).toContain('Could not find exact match for edit');

      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe(initialContent);
    });

    test('should handle empty file', async () => {
      // Create empty file
      await fs.writeFile(testFilePath, '');

      const edits = [
        {
          oldText: '',
          newText: 'New content',
        },
      ];

      const result = await applyFileEdits(testDir, testFilePath, edits, undefined);

      expect(result.newFileCreated).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.validEdits).toBe(true);

      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe('New content');
    });
  });

  // Windows-specific tests
  if (process.platform === 'win32') {
    const windowsTempDir = os.tmpdir();

    describe('Windows paths', () => {
      test('should handle Windows paths with spaces', async () => {
        const spacePath = path.join(windowsTempDir, 'test folder', 'file with spaces.txt');
        await fs.mkdir(path.join(windowsTempDir, 'test folder'), {recursive: true});

        const content = 'Initial content';
        const result = await applyFileEdits(windowsTempDir, spacePath, undefined, content);

        expect(result.newFileCreated).toBe(true);
        expect(result.fileExists).toBe(false);
        expect(result.validEdits).toBe(true);

        const fileContent = await fs.readFile(spacePath, 'utf-8');
        expect(fileContent).toBe(content);
      });

      test('should handle Windows paths with special characters', async () => {
        const specialPath = path.join(windowsTempDir, 'test#folder', 'file@test.txt');
        await fs.mkdir(path.join(windowsTempDir, 'test#folder'), {recursive: true});

        const content = 'Content with special chars';
        const result = await applyFileEdits(windowsTempDir, specialPath, undefined, content);

        expect(result.newFileCreated).toBe(true);
        expect(result.fileExists).toBe(false);
        expect(result.validEdits).toBe(true);

        const fileContent = await fs.readFile(specialPath, 'utf-8');
        expect(fileContent).toBe(content);
      });
    });
  }
});
