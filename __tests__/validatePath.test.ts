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

  test('should validate path within allowed directories', async () => {
    const testFilePath = path.join(testDir, 'test.txt');
    const validatedPath = await validatePath(testFilePath, allowedDirectories);
    expect(validatedPath).toBe(path.resolve(testFilePath));
  });

  test('should expand home directory path', async () => {
    const homePath = '~/test.txt';
    const expandedPath = path.join(os.homedir(), 'test.txt');
    const validatedPath = await validatePath(homePath, [os.homedir()]);
    expect(validatedPath).toBe(path.resolve(expandedPath));
  });

  test('should throw error for path outside allowed directories', async () => {
    const outsidePath = path.join(process.cwd(), 'outside.txt');
    await expect(validatePath(outsidePath, allowedDirectories)).rejects.toThrow(
      'Access denied - path outside allowed directories',
    );
  });

  test('should handle symlinks within allowed directories pointing to allowed directories', async () => {
    const targetPath = path.join(testDir, 'target.txt');
    const symlinkPath = path.join(testDir, 'symlink.txt');

    // Create target file
    await fs.writeFile(targetPath, 'test content');
    await fs.symlink(targetPath, symlinkPath);

    const validatedPath = await validatePath(symlinkPath, allowedDirectories);
    expect(validatedPath).toBe(path.resolve(targetPath));

    // Clean up
    await fs.unlink(symlinkPath);
    await fs.unlink(targetPath);
  });

  test('should allow symlinks within allowed directories pointing outside', async () => {
    const outsidePath = path.join(process.cwd(), 'outside.txt');
    const symlinkPath = path.join(testDir, 'symlink.txt');

    // Create target file outside allowed directories
    await fs.writeFile(outsidePath, 'test content');
    await fs.symlink(outsidePath, symlinkPath);

    const validatedPath = await validatePath(symlinkPath, allowedDirectories);
    expect(validatedPath).toBe(path.resolve(outsidePath));

    // Clean up
    await fs.unlink(symlinkPath);
    await fs.unlink(outsidePath);
  });

  test('should handle non-existent files with valid parent directory', async () => {
    const newDir = path.join(testDir, 'new');
    await fs.mkdir(newDir, {recursive: true});
    const newFilePath = path.join(newDir, 'file.txt');
    const validatedPath = await validatePath(newFilePath, allowedDirectories);
    expect(validatedPath).toBe(path.resolve(newFilePath));
  });

  test('should throw error for non-existent parent directory', async () => {
    const invalidPath = path.join(testDir, 'nonexistent', 'file.txt');
    await expect(validatePath(invalidPath, allowedDirectories)).rejects.toThrow(
      'Parent directory does not exist',
    );
  });

  // Windows-specific tests
  if (process.platform === 'win32') {
    const windowsTempDir = os.tmpdir();
    const driveLetter = windowsTempDir.split(':')[0];

    test('should handle Windows absolute paths with drive letters', async () => {
      const windowsPath = `${driveLetter}:\\Windows\\Temp\\test\\file.txt`;
      const allowedDirs = [`${driveLetter}:\\Windows\\Temp`];
      const validatedPath = await validatePath(windowsPath, allowedDirs);
      expect(validatedPath).toBe(path.resolve(windowsPath));
    });

    test('should handle Windows paths with spaces', async () => {
      const spacePath = `${driveLetter}:\\Program Files\\test\\file.txt`;
      const allowedDirs = [`${driveLetter}:\\Program Files`];
      const validatedPath = await validatePath(spacePath, allowedDirs);
      expect(validatedPath).toBe(path.resolve(spacePath));
    });
  }
});
