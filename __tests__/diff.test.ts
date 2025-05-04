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

  test('should return raw diff for file edits', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, 'diff-test.js');
    const initialContent = 'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));';
    await fs.writeFile(testFilePath, initialContent);

    fileEditTool = new FileEditTool(
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

    // console.log(response.rawDiff);
    // console.log(response.toolCallCount);

    // Verify the response contains the raw diff
    expect(response.rawDiff).toBeDefined();
    expect(response.rawDiff).not.toBe('');

    // Verify the raw diff format
    const rawDiff = response.rawDiff!;

    // Index: /Users/paradite/workspace/ai-file-edit/sample-diff/diff-test.js
    // ===================================================================
    // --- /Users/paradite/workspace/ai-file-edit/sample-diff/diff-test.js original
    // +++ /Users/paradite/workspace/ai-file-edit/sample-diff/diff-test.js modified
    // @@ -1,2 +1,2 @@
    // -function add(a, b) { return a + b; }
    // -console.log(add(1, 2));
    // \\ No newline at end of file
    // +function multiply(a, b) { return a * b; }
    // +console.log(multiply(1, 2));
    // \\ No newline at end of file

    expect(rawDiff).toContain('sample-diff/diff-test.js');
    expect(rawDiff).toContain('---');
    expect(rawDiff).toContain('+++');
    expect(rawDiff).toContain('@@');
    expect(rawDiff).toContain('-function add(a, b) { return a + b; }');
    expect(rawDiff).toContain('+function multiply(a, b) { return a * b; }');
    expect(rawDiff).toContain('-console.log(add(1, 2));');
    expect(rawDiff).toContain('+console.log(multiply(1, 2));');
  });

  test('should return raw diff for new file creation', async () => {
    // Define path for new file
    const newFilePath = path.join(testDir, 'new-file.js');

    fileEditTool = new FileEditTool(
      [testDir],
      model,
      AI_PROVIDERS.ANTHROPIC,
      process.env.ANTHROPIC_API_KEY || '',
      [],
    );

    // Test creating a new file and getting diff
    const response = await fileEditTool.processQuery(
      `create new file ${newFilePath} with content: function greet(name) { return "Hello, " + name; }`,
    );

    // console.log('Create new file response:');
    // console.log(response.finalText);
    // console.log(response.toolResults);
    // console.log(response.rawDiff);
    // console.log(response.toolCallCount);

    // Verify the response contains the raw diff
    expect(response.rawDiff).toBeDefined();
    expect(response.rawDiff).not.toBe('');

    // Verify the raw diff format for new file
    const rawDiff = response.rawDiff!;

    // Index: /Users/paradite/workspace/ai-file-edit/sample-diff/new-file.js
    // ===================================================================
    // --- /Users/paradite/workspace/ai-file-edit/sample-diff/new-file.js  original
    // +++ /Users/paradite/workspace/ai-file-edit/sample-diff/new-file.js  modified
    // @@ -0,0 +1,1 @@
    // +function greet(name) { return "Hello, " + name; }
    // \ No newline at end of file

    expect(rawDiff).toContain('sample-diff/new-file.js');
    expect(rawDiff).toContain('---');
    expect(rawDiff).toContain('+++');
    expect(rawDiff).toContain('@@ -0,0 +1,1 @@');
    expect(rawDiff).toContain('+function greet(name) { return "Hello, " + name; }');
    expect(rawDiff).toContain('\\ No newline at end of file');
  });

  test('should return reverse diff for file edits and be able to revert changes', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, 'reverse-diff-test.js');
    const initialContent = 'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));';
    await fs.writeFile(testFilePath, initialContent);

    fileEditTool = new FileEditTool(
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

    // Verify the reverse diff format
    const reverseDiff = response.reverseDiff!;

    // The reverse diff should have swapped the - and + lines compared to the forward diff
    expect(reverseDiff).toContain('sample-diff/reverse-diff-test.js');
    expect(reverseDiff).toContain('---');
    expect(reverseDiff).toContain('+++');
    expect(reverseDiff).toContain('@@');
    expect(reverseDiff).toContain('-function multiply(a, b) { return a * b; }');
    expect(reverseDiff).toContain('+function add(a, b) { return a + b; }');
    expect(reverseDiff).toContain('-console.log(multiply(1, 2));');
    expect(reverseDiff).toContain('+console.log(add(1, 2));');

    // Verify we can use the reverse diff to revert changes
    const modifiedContent = await fs.readFile(testFilePath, 'utf-8');
    expect(modifiedContent).toBe(
      'function multiply(a, b) { return a * b; }\nconsole.log(multiply(1, 2));',
    );

    // Apply the reverse patch using the new function
    const result = await applyReversePatch(testFilePath, reverseDiff);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify the file was reverted to initialContent
    const finalContent = await fs.readFile(testFilePath, 'utf-8');
    expect(finalContent).toBe(initialContent);
  });
});
