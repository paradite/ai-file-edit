import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';
import {applyReversePatch} from '../utils/fileUtils';

const model = ModelEnum['claude-3-7-sonnet-20250219'];

jest.retryTimes(1);

describe('File Edit Tool with Claude - Multiple Files', () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-claude-multiple');

  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(path.join(testDir, '1'), {recursive: true});
    await fs.mkdir(path.join(testDir, '2'), {recursive: true});
  });

  afterAll(async () => {
    // Clean up test directories
    await fs.rm(testDir, {recursive: true, force: true});
  });

  test('should edit multiple files in allowed directory', async () => {
    // Create test files with initial content
    const file1Path = path.join(testDir, '1', 'file1.js');
    const file2Path = path.join(testDir, '1', 'file2.js');
    const file3Path = path.join(testDir, '1', 'file3.js');

    await fs.writeFile(file1Path, 'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));');
    await fs.writeFile(
      file2Path,
      'function subtract(a, b) { return a - b; }\nconsole.log(subtract(5, 3));',
    );
    await fs.writeFile(
      file3Path,
      'function divide(a, b) { return a / b; }\nconsole.log(divide(10, 2));',
    );

    fileEditTool = new FileEditTool(
      testDir,
      [path.join(testDir, '1')],
      {
        provider: AI_PROVIDERS.ANTHROPIC,
        model: model,
        apiKey: process.env.ANTHROPIC_API_KEY || '',
      },
      [
        path.join(testDir, '1', 'file1.js'),
        path.join(testDir, '1', 'file2.js'),
        path.join(testDir, '1', 'file3.js'),
      ],
      5,
    );

    // Test editing multiple files in allowed directory
    const response = await fileEditTool.processQuery(
      `update all three files to change the arithmetic operations to multiplication. 
       In ${file1Path}, change add to multiply and update the function calls.
       In ${file2Path}, change subtract to multiply and update the function calls.
       In ${file3Path}, change divide to multiply and update the function calls.`,
      true,
    );

    // console.log('Tool results:', response.toolResults.join('\n'));
    // console.log('Response:', response.finalText.join('\n'));
    // console.log('Final status:', response.finalStatus);
    // console.log('Tool call count:', response.toolCallCount);
    // console.log('Raw diff:', response.rawDiff);
    // console.log('Reverse diff:', response.reverseDiff);

    expect(response.finalText.join('\n')).toContain('Successfully updated file');
    expect(response.finalStatus).toBe('success');
    expect(response.toolCallCount).toBeGreaterThanOrEqual(3);
    expect(response.toolCallCount).toBeLessThanOrEqual(4);
    expect(response.toolCallRounds).toBeLessThanOrEqual(4);

    // Verify the files were edited correctly
    const file1Content = await fs.readFile(file1Path, 'utf-8');
    const file2Content = await fs.readFile(file2Path, 'utf-8');
    const file3Content = await fs.readFile(file3Path, 'utf-8');

    // Check file1
    expect(file1Content).toContain('function multiply(a, b)');
    expect(file1Content).toContain('a * b');
    expect(file1Content).toContain('console.log(multiply(1, 2));');
    expect(file1Content).not.toContain('function add(a, b)');
    expect(file1Content).not.toContain('a + b');
    expect(file1Content).not.toContain('console.log(add(1, 2));');

    // Check file2
    expect(file2Content).toContain('function multiply(a, b)');
    expect(file2Content).toContain('a * b');
    expect(file2Content).toContain('console.log(multiply(5, 3));');
    expect(file2Content).not.toContain('function subtract(a, b)');
    expect(file2Content).not.toContain('a - b');
    expect(file2Content).not.toContain('console.log(subtract(5, 3));');

    // Check file3
    expect(file3Content).toContain('function multiply(a, b)');
    expect(file3Content).toContain('a * b');
    expect(file3Content).toContain('console.log(multiply(10, 2));');
    expect(file3Content).not.toContain('function divide(a, b)');
    expect(file3Content).not.toContain('a / b');
    expect(file3Content).not.toContain('console.log(divide(10, 2));');

    // Verify raw diffs for all files
    expect(response.rawDiff).toBeDefined();
    expect(response.rawDiff).not.toBe('');
    expect(response.rawDiff![file1Path]).toBeDefined();
    expect(response.rawDiff![file2Path]).toBeDefined();
    expect(response.rawDiff![file3Path]).toBeDefined();

    // Verify file1 raw diff format
    const file1RawDiff = response.rawDiff![file1Path];
    expect(file1RawDiff).toContain('1/file1.js');
    expect(file1RawDiff).toContain('---');
    expect(file1RawDiff).toContain('+++');
    expect(file1RawDiff).toContain('@@');
    expect(file1RawDiff).toContain('-function add(a, b) { return a + b; }');
    expect(file1RawDiff).toContain('+function multiply(a, b) { return a * b; }');
    expect(file1RawDiff).toContain('-console.log(add(1, 2));');
    expect(file1RawDiff).toContain('+console.log(multiply(1, 2));');

    // Verify file2 raw diff format
    const file2RawDiff = response.rawDiff![file2Path];
    expect(file2RawDiff).toContain('1/file2.js');
    expect(file2RawDiff).toContain('---');
    expect(file2RawDiff).toContain('+++');
    expect(file2RawDiff).toContain('@@');
    expect(file2RawDiff).toContain('-function subtract(a, b) { return a - b; }');
    expect(file2RawDiff).toContain('+function multiply(a, b) { return a * b; }');
    expect(file2RawDiff).toContain('-console.log(subtract(5, 3));');
    expect(file2RawDiff).toContain('+console.log(multiply(5, 3));');

    // Verify file3 raw diff format
    const file3RawDiff = response.rawDiff![file3Path];
    expect(file3RawDiff).toContain('1/file3.js');
    expect(file3RawDiff).toContain('---');
    expect(file3RawDiff).toContain('+++');
    expect(file3RawDiff).toContain('@@');
    expect(file3RawDiff).toContain('-function divide(a, b) { return a / b; }');
    expect(file3RawDiff).toContain('+function multiply(a, b) { return a * b; }');
    expect(file3RawDiff).toContain('-console.log(divide(10, 2));');
    expect(file3RawDiff).toContain('+console.log(multiply(10, 2));');

    // Verify reverse diffs for all files
    expect(response.reverseDiff).toBeDefined();
    expect(response.reverseDiff).not.toBe('');
    expect(response.reverseDiff![file1Path]).toBeDefined();
    expect(response.reverseDiff![file2Path]).toBeDefined();
    expect(response.reverseDiff![file3Path]).toBeDefined();

    // Verify file1 reverse diff format
    const file1ReverseDiff = response.reverseDiff![file1Path];
    expect(file1ReverseDiff).toContain('1/file1.js');
    expect(file1ReverseDiff).toContain('---');
    expect(file1ReverseDiff).toContain('+++');
    expect(file1ReverseDiff).toContain('@@');
    expect(file1ReverseDiff).toContain('-function multiply(a, b) { return a * b; }');
    expect(file1ReverseDiff).toContain('+function add(a, b) { return a + b; }');
    expect(file1ReverseDiff).toContain('-console.log(multiply(1, 2));');
    expect(file1ReverseDiff).toContain('+console.log(add(1, 2));');

    // Verify file2 reverse diff format
    const file2ReverseDiff = response.reverseDiff![file2Path];
    expect(file2ReverseDiff).toContain('1/file2.js');
    expect(file2ReverseDiff).toContain('---');
    expect(file2ReverseDiff).toContain('+++');
    expect(file2ReverseDiff).toContain('@@');
    expect(file2ReverseDiff).toContain('-function multiply(a, b) { return a * b; }');
    expect(file2ReverseDiff).toContain('+function subtract(a, b) { return a - b; }');
    expect(file2ReverseDiff).toContain('-console.log(multiply(5, 3));');
    expect(file2ReverseDiff).toContain('+console.log(subtract(5, 3));');

    // Verify file3 reverse diff format
    const file3ReverseDiff = response.reverseDiff![file3Path];
    expect(file3ReverseDiff).toContain('1/file3.js');
    expect(file3ReverseDiff).toContain('---');
    expect(file3ReverseDiff).toContain('+++');
    expect(file3ReverseDiff).toContain('@@');
    expect(file3ReverseDiff).toContain('-function multiply(a, b) { return a * b; }');
    expect(file3ReverseDiff).toContain('+function divide(a, b) { return a / b; }');
    expect(file3ReverseDiff).toContain('-console.log(multiply(10, 2));');
    expect(file3ReverseDiff).toContain('+console.log(divide(10, 2));');

    // Apply the reverse patches
    const result1 = await applyReversePatch(file1Path, file1ReverseDiff);
    const result2 = await applyReversePatch(file2Path, file2ReverseDiff);
    const result3 = await applyReversePatch(file3Path, file3ReverseDiff);

    expect(result1.success).toBe(true);
    expect(result1.error).toBeUndefined();
    expect(result2.success).toBe(true);
    expect(result2.error).toBeUndefined();
    expect(result3.success).toBe(true);
    expect(result3.error).toBeUndefined();

    // Verify the files were reverted to initial content
    const finalFile1Content = await fs.readFile(file1Path, 'utf-8');
    const finalFile2Content = await fs.readFile(file2Path, 'utf-8');
    const finalFile3Content = await fs.readFile(file3Path, 'utf-8');

    expect(finalFile1Content).toBe('function add(a, b) { return a + b; }\nconsole.log(add(1, 2));');
    expect(finalFile2Content).toBe(
      'function subtract(a, b) { return a - b; }\nconsole.log(subtract(5, 3));',
    );
    expect(finalFile3Content).toBe(
      'function divide(a, b) { return a / b; }\nconsole.log(divide(10, 2));',
    );

    // Re-apply the changes to get back to the modified state
    const result4 = await applyReversePatch(file1Path, file1RawDiff);
    const result5 = await applyReversePatch(file2Path, file2RawDiff);
    const result6 = await applyReversePatch(file3Path, file3RawDiff);

    expect(result4.success).toBe(true);
    expect(result4.error).toBeUndefined();
    expect(result5.success).toBe(true);
    expect(result5.error).toBeUndefined();
    expect(result6.success).toBe(true);
    expect(result6.error).toBeUndefined();
  });
});
