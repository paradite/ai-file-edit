import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {createTwoFilesPatch, parsePatch, reversePatch, formatPatch, applyPatch} from 'diff';

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

// Line ending utilities
export function getPlatformLineEnding(): string {
  return os.platform() === 'win32' ? '\r\n' : '\n';
}

export function detectLineEnding(text: string): string {
  // Check for Windows line endings first
  if (text.includes('\r\n')) {
    return '\r\n';
  }
  // Check for Unix line endings
  if (text.includes('\n')) {
    return '\n';
  }
  // Default to platform line ending if no line endings found
  return getPlatformLineEnding();
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function applyPlatformLineEndings(text: string, targetLineEnding?: string): string {
  // First normalize to Unix line endings
  const normalized = normalizeLineEndings(text);
  // Then apply the target line ending (default to platform line ending)
  const lineEnding = targetLineEnding || getPlatformLineEnding();
  return lineEnding === '\n' ? normalized : normalized.replace(/\n/g, lineEnding);
}

// Security utilities
export async function validatePath(
  parentDir: string,
  requestedPath: string,
  allowedDirectories: string[],
): Promise<string> {
  const expandedParentDir = expandHome(parentDir);
  const expandedPath = expandHome(requestedPath);

  // Resolve the requested path relative to parent directory if it's not absolute
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(expandedParentDir, expandedPath);

  const normalizedRequested = normalizePath(absolute);
  const normalizedAllowed = allowedDirectories.map(dir =>
    normalizePath(path.resolve(expandHome(dir))),
  );

  // First check if the requested path is within allowed directories
  const isAllowed = normalizedAllowed.some(dir => normalizedRequested.startsWith(dir));
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${normalizedAllowed.join(
        ', ',
      )}`,
    );
  }

  // Check if the path exists
  try {
    const stats = await fs.lstat(absolute);
    if (stats.isSymbolicLink()) {
      // For symlinks, we trust them if they are within allowed directories
      // Get the real path for returning, but don't validate it
      const realPath = await fs.realpath(absolute);
      return realPath;
    }
    return absolute;
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute);
    try {
      const realParentPath = await fs.realpath(parentDir);
      const normalizedParent = normalizePath(realParentPath);
      const isParentAllowed = normalizedAllowed.some(dir => normalizedParent.startsWith(dir));
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

export function createReverseUnifiedDiff(
  originalContent: string,
  newContent: string,
  filepath: string = 'file',
): string {
  // Create the forward diff
  const forwardDiff = createUnifiedDiff(originalContent, newContent, filepath);
  // Parse the diff into a structured format
  const parsedPatch = parsePatch(forwardDiff);
  // Reverse the patch
  const reversedPatch = reversePatch(parsedPatch);
  // Format the reversed patch back into a string
  return formatPatch(reversedPatch);
}

export async function applyFileEdits(
  parentDir: string,
  filePath: string,
  edits: Array<{oldText: string; newText: string}> | undefined,
  content: string | undefined,
): Promise<{
  response: string;
  rawDiff: string;
  fileExists: boolean;
  newFileCreated: boolean;
  validEdits: boolean;
  reverseDiff: string;
}> {
  let originalContent = '';
  let fileExists = false;
  let newFileCreated = false;
  let validEdits = false;
  let originalLineEnding = getPlatformLineEnding(); // Default to platform line ending

  // Resolve the file path relative to parentDir if it's not absolute
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(parentDir, filePath);

  try {
    const rawContent = await fs.readFile(absolutePath, 'utf-8');
    originalLineEnding = detectLineEnding(rawContent); // Preserve original line ending
    originalContent = normalizeLineEndings(rawContent);
    fileExists = true;
  } catch (error) {
    // File doesn't exist yet, treat as empty content
    originalContent = '';
    // For new files, use platform line ending
    originalLineEnding = getPlatformLineEnding();
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
        return {
          response: `Error: Could not find exact match for edit:\n${edit.oldText}`,
          rawDiff: '',
          fileExists,
          newFileCreated,
          validEdits: false,
          reverseDiff: '',
        };
      }
    }
  }

  // Create unified diff
  const rawDiff = createUnifiedDiff(originalContent, modifiedContent, absolutePath);
  // Create reverse diff
  const reverseDiff = createReverseUnifiedDiff(originalContent, modifiedContent, absolutePath);

  if (originalContent === modifiedContent) {
    validEdits = false;
  } else {
    validEdits = true;
  }

  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (rawDiff.includes('`'.repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${rawDiff}${'`'.repeat(
    numBackticks,
  )}\n\n`;

  // Apply appropriate line endings before writing to file
  const contentToWrite = applyPlatformLineEndings(modifiedContent, originalLineEnding);
  await fs.writeFile(absolutePath, contentToWrite, 'utf-8');

  let response = '';

  if (!fileExists) {
    newFileCreated = true;
  }

  if (newFileCreated) {
    response = `Successfully created file ${absolutePath} with content:\n${modifiedContent}`;
  } else if (validEdits) {
    response = `Successfully updated file ${absolutePath} with diff:\n${formattedDiff}`;
  } else {
    response = `No edits were made to file ${absolutePath}`;
  }

  return {response, rawDiff, fileExists, newFileCreated, validEdits, reverseDiff};
}

export async function applyReversePatch(
  filePath: string,
  reverseDiff: string,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Read the current content of the file
    const currentContent = await fs.readFile(filePath, 'utf-8');

    // Parse the reverse diff
    const patches = parsePatch(reverseDiff);
    if (!patches || patches.length === 0) {
      return {
        success: false,
        error: 'Invalid reverse diff format',
      };
    }

    // Apply the reverse patch
    const revertedContent = applyPatch(currentContent, patches[0]);
    if (typeof revertedContent !== 'string') {
      return {
        success: false,
        error: 'Failed to apply reverse patch',
      };
    }

    // Write the reverted content back to the file
    await fs.writeFile(filePath, revertedContent, 'utf-8');

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
