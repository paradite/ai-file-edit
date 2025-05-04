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

  try {
    originalContent = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
    fileExists = true;
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
  const rawDiff = createUnifiedDiff(originalContent, modifiedContent, filePath);
  // Create reverse diff
  const reverseDiff = createReverseUnifiedDiff(originalContent, modifiedContent, filePath);

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

  await fs.writeFile(filePath, modifiedContent, 'utf-8');

  let response = '';

  if (!fileExists) {
    newFileCreated = true;
  }

  if (newFileCreated) {
    response = `Successfully created file ${filePath} with content:\n${modifiedContent}`;
  } else if (validEdits) {
    response = `Successfully updated file ${filePath} with diff:\n${formattedDiff}`;
  } else {
    response = `No edits were made to file ${filePath}`;
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
