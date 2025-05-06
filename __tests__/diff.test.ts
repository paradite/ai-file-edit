import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';
import {applyReversePatch} from '../utils/fileUtils';

const model = ModelEnum['claude-3-7-sonnet-20250219'];

jest.retryTimes(1);

describe('Diff Output Tests', () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-diff');

  beforeAll(async () => {
    // Create test directory
    await fs.mkdir(testDir, {recursive: true});
  });

  afterAll(async () => {
    // Clean up test directory
    await fs.rm(testDir, {recursive: true, force: true});
  });

  test('should return raw diff and reverse diff for file edits and be able to revert changes', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, 'combined-diff-test.js');
    const initialContent = 'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));';
    await fs.writeFile(testFilePath, initialContent);

    fileEditTool = new FileEditTool(
      testDir,
      [testDir],
      model,
      AI_PROVIDERS.ANTHROPIC,
      process.env.ANTHROPIC_API_KEY || '',
      [testFilePath],
    );

    // Test editing file and getting diff
    const response = await fileEditTool.processQuery(
      `update ${testFilePath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
    );

    // Verify the response contains both forward and reverse diffs
    expect(response.rawDiff).toBeDefined();
    expect(response.rawDiff).not.toBe('');
    expect(response.reverseDiff).toBeDefined();
    expect(response.reverseDiff).not.toBe('');

    // Verify the raw diff format
    const rawDiff = response.rawDiff![testFilePath];
    expect(rawDiff).toContain('sample-diff/combined-diff-test.js');
    expect(rawDiff).toContain('---');
    expect(rawDiff).toContain('+++');
    expect(rawDiff).toContain('@@');
    expect(rawDiff).toContain('-function add(a, b) { return a + b; }');
    expect(rawDiff).toContain('+function multiply(a, b) { return a * b; }');
    expect(rawDiff).toContain('-console.log(add(1, 2));');
    expect(rawDiff).toContain('+console.log(multiply(1, 2));');

    // Verify the reverse diff format
    const reverseDiff = response.reverseDiff![testFilePath];
    expect(reverseDiff).toContain('sample-diff/combined-diff-test.js');
    expect(reverseDiff).toContain('---');
    expect(reverseDiff).toContain('+++');
    expect(reverseDiff).toContain('@@');
    expect(reverseDiff).toContain('-function multiply(a, b) { return a * b; }');
    expect(reverseDiff).toContain('+function add(a, b) { return a + b; }');
    expect(reverseDiff).toContain('-console.log(multiply(1, 2));');
    expect(reverseDiff).toContain('+console.log(add(1, 2));');

    // Verify the file was modified correctly
    const modifiedContent = await fs.readFile(testFilePath, 'utf-8');
    expect(modifiedContent).toBe(
      'function multiply(a, b) { return a * b; }\nconsole.log(multiply(1, 2));',
    );

    // Apply the reverse patch to revert changes
    const result = await applyReversePatch(testFilePath, reverseDiff);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify the file was reverted to initialContent
    const finalContent = await fs.readFile(testFilePath, 'utf-8');
    expect(finalContent).toBe(initialContent);
  });
});
