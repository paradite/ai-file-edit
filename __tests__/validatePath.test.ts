import {validatePath} from '../utils/fileUtils';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('validatePath', () => {
  const testDir = path.join(process.cwd(), 'sample-validate-path');
  const allowedDirectories = [testDir];

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
    // Clean up any leftover symlinks before each test
    try {
      await fs.unlink(path.join(testDir, 'symlink.txt'));
    } catch (error) {
      // Ignore errors if file doesn't exist
    }
  });

  describe('absolute paths', () => {
    test('should validate path within allowed directories', async () => {
      const testFilePath = path.join(testDir, 'test.txt');
      const validatedPath = await validatePath(testDir, testFilePath, allowedDirectories);
      expect(validatedPath).toBe(path.resolve(testFilePath));
    });

    test('should throw error for path outside allowed directories', async () => {
      const outsidePath = path.join(process.cwd(), 'outside.txt');
      await expect(validatePath(process.cwd(), outsidePath, allowedDirectories)).rejects.toThrow(
        'Access denied - path outside allowed directories',
      );
    });
  });

  describe('home directory paths', () => {
    test('should expand home directory path', async () => {
      const homePath = '~/test.txt';
      const expandedPath = path.join(os.homedir(), 'test.txt');
      const validatedPath = await validatePath(os.homedir(), homePath, [os.homedir()]);
      expect(validatedPath).toBe(path.resolve(expandedPath));
    });
  });

  describe('relative paths', () => {
    test('should handle relative path with ./ prefix', async () => {
      const parentDir = path.join(testDir, 'parent');
      const relativePath = './child/file.txt';
      const expectedPath = path.join(parentDir, 'child', 'file.txt');

      await fs.mkdir(path.join(parentDir, 'child'), {recursive: true});
      const validatedPath = await validatePath(parentDir, relativePath, allowedDirectories);
      expect(validatedPath).toBe(path.resolve(expectedPath));
    });

    test('should handle relative path without ./ prefix', async () => {
      const parentDir = path.join(testDir, 'parent');
      const relativePath = 'child/file.txt';
      const expectedPath = path.join(parentDir, 'child', 'file.txt');

      await fs.mkdir(path.join(parentDir, 'child'), {recursive: true});
      const validatedPath = await validatePath(parentDir, relativePath, allowedDirectories);
      expect(validatedPath).toBe(path.resolve(expectedPath));
    });

    test('should handle relative path with parent directory traversal', async () => {
      const parentDir = path.join(testDir, 'parent');
      const relativePath = '../sibling/file.txt';
      const expectedPath = path.join(testDir, 'sibling', 'file.txt');

      await fs.mkdir(parentDir, {recursive: true});
      await fs.mkdir(path.join(testDir, 'sibling'), {recursive: true});
      const validatedPath = await validatePath(parentDir, relativePath, allowedDirectories);
      expect(validatedPath).toBe(path.resolve(expectedPath));
    });

    test('should throw error for relative path that resolves outside allowed directories', async () => {
      const parentDir = path.join(testDir, 'parent');
      const relativePath = '../../outside.txt';

      await fs.mkdir(parentDir, {recursive: true});
      await expect(validatePath(parentDir, relativePath, allowedDirectories)).rejects.toThrow(
        'Access denied - path outside allowed directories',
      );
    });
  });

  describe('symlinks', () => {
    test('should handle symlinks within allowed directories pointing to allowed directories', async () => {
      const targetPath = path.join(testDir, 'target.txt');
      const symlinkPath = path.join(testDir, 'symlink.txt');

      await fs.writeFile(targetPath, 'test content');
      await fs.symlink(targetPath, symlinkPath);

      const validatedPath = await validatePath(testDir, symlinkPath, allowedDirectories);
      expect(validatedPath).toBe(path.resolve(targetPath));

      // Clean up
      await fs.unlink(symlinkPath);
      await fs.unlink(targetPath);
    });

    test('should allow symlinks within allowed directories pointing outside', async () => {
      const outsidePath = path.join(process.cwd(), 'outside.txt');
      const symlinkPath = path.join(testDir, 'symlink.txt');

      await fs.writeFile(outsidePath, 'test content');
      await fs.symlink(outsidePath, symlinkPath);

      const validatedPath = await validatePath(testDir, symlinkPath, allowedDirectories);
      expect(validatedPath).toBe(path.resolve(outsidePath));

      // Clean up
      await fs.unlink(symlinkPath);
      await fs.unlink(outsidePath);
    });
  });

  describe('file existence', () => {
    test('should handle non-existent files with valid parent directory', async () => {
      const newDir = path.join(testDir, 'new');
      await fs.mkdir(newDir, {recursive: true});
      const newFilePath = path.join(newDir, 'file.txt');
      const validatedPath = await validatePath(newDir, newFilePath, allowedDirectories);
      expect(validatedPath).toBe(path.resolve(newFilePath));
    });

    test('should throw error for non-existent parent directory', async () => {
      const invalidPath = path.join(testDir, 'nonexistent', 'file.txt');
      await expect(validatePath(testDir, invalidPath, allowedDirectories)).rejects.toThrow(
        'Parent directory does not exist',
      );
    });
  });

  // Windows-specific tests
  if (process.platform === 'win32') {
    const windowsTempDir = os.tmpdir();
    const driveLetter = windowsTempDir.split(':')[0];

    describe('Windows paths', () => {
      test('should handle Windows absolute paths with drive letters', async () => {
        const testDir = `${driveLetter}:\\test_validate_path`;
        await fs.mkdir(testDir, {recursive: true});

        const windowsPath = `${driveLetter}:\\test_validate_path\\file.txt`;
        const allowedDirs = [`${driveLetter}:\\`];
        const validatedPath = await validatePath(testDir, windowsPath, allowedDirs);
        expect(validatedPath).toBe(path.resolve(windowsPath));
      });

      test('should handle Windows paths with spaces', async () => {
        const testDir = `${driveLetter}:\\test folder`;
        await fs.mkdir(testDir, {recursive: true});

        const spacePath = `${driveLetter}:\\test folder\\file.txt`;
        const allowedDirs = [`${driveLetter}:\\`];
        const validatedPath = await validatePath(testDir, spacePath, allowedDirs);
        expect(validatedPath).toBe(path.resolve(spacePath));
      });

      test('should handle Windows TEMP paths', async () => {
        const testDir = path.join(windowsTempDir, 'test_validate_path');
        await fs.mkdir(testDir, {recursive: true});

        const tempPath = path.join(testDir, 'file.txt');
        await fs.writeFile(tempPath, 'test content');

        const allowedDirs = [windowsTempDir];
        const validatedPath = await validatePath(testDir, tempPath, allowedDirs);
        expect(validatedPath).toBe(path.resolve(tempPath));

        // Clean up
        await fs.unlink(tempPath);
        await fs.rmdir(testDir);
      });
    });
  }
});
