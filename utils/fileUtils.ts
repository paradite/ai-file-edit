import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {createTwoFilesPatch} from 'diff';

// Normalize all paths consistently
export function normalizePath(p: string): string {
  return path.normalize(p);
}

export function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

// Security utilities
export async function validatePath(
  requestedPath: string,
  allowedDirectories: string[],
): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(
        ', ',
      )}`,
    );
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
    if (!isRealPathAllowed) {
      throw new Error('Access denied - symlink target outside allowed directories');
    }
    return realPath;
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute);
    try {
      const realParentPath = await fs.realpath(parentDir);
      const normalizedParent = normalizePath(realParentPath);
      const isParentAllowed = allowedDirectories.some(dir => normalizedParent.startsWith(dir));
      if (!isParentAllowed) {
        throw new Error('Access denied - parent directory outside allowed directories');
      }
      return absolute;
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  }
}

// File editing and diffing utilities
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function createUnifiedDiff(
  originalContent: string,
  newContent: string,
  filepath: string = 'file',
): string {
  // Ensure consistent line endings for diff
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    'original',
    'modified',
  );
}

export async function applyFileEdits(
  filePath: string,
  edits: Array<{oldText: string; newText: string}> | undefined,
  content: string | undefined,
  dryRun = false,
): Promise<string> {
  let originalContent = '';
  try {
    originalContent = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
  } catch (error) {
    // File doesn't exist yet, treat as empty content
    originalContent = '';
  }

  let modifiedContent = originalContent;

  if (content !== undefined) {
    // Complete file content provided, use it directly
    modifiedContent = normalizeLineEndings(content);
  } else if (edits !== undefined) {
    // Apply edits sequentially
    for (const edit of edits) {
      const normalizedOld = normalizeLineEndings(edit.oldText);
      const normalizedNew = normalizeLineEndings(edit.newText);

      // If exact match exists, use it
      if (modifiedContent.includes(normalizedOld)) {
        modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
        continue;
      }

      // Otherwise, try line-by-line matching with flexibility for whitespace
      const oldLines = normalizedOld.split('\n');
      const contentLines = modifiedContent.split('\n');
      let matchFound = false;

      for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
        const potentialMatch = contentLines.slice(i, i + oldLines.length);

        // Compare lines with normalized whitespace
        const isMatch = oldLines.every((oldLine, j) => {
          const contentLine = potentialMatch[j];
          return oldLine.trim() === contentLine.trim();
        });

        if (isMatch) {
          // Preserve original indentation of first line
          const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
          const newLines = normalizedNew.split('\n').map((line, j) => {
            if (j === 0) return originalIndent + line.trimStart();
            // For subsequent lines, try to preserve relative indentation
            const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
            const newIndent = line.match(/^\s*/)?.[0] || '';
            if (oldIndent && newIndent) {
              const relativeIndent = newIndent.length - oldIndent.length;
              return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
            }
            return line;
          });

          contentLines.splice(i, oldLines.length, ...newLines);
          modifiedContent = contentLines.join('\n');
          matchFound = true;
          break;
        }
      }

      if (!matchFound) {
        return `Error: Could not find exact match for edit:\n${edit.oldText}`;
      }
    }
  }

  // Create unified diff
  const diff = createUnifiedDiff(originalContent, modifiedContent, filePath);

  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (diff.includes('`'.repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;

  if (!dryRun) {
    await fs.writeFile(filePath, modifiedContent, 'utf-8');
  }

  const response = `Successfully ${
    originalContent ? 'updated' : 'created'
  } file ${filePath} with diff:\n${formattedDiff}`;

  return response;
}
