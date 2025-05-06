import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

const model = ModelEnum['gpt-4.1'];

jest.retryTimes(1);

describe('File Edit Tool with OpenAI - Multiple Files', () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-openai-multiple');

  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(path.join(testDir, '1'), {recursive: true});
    await fs.mkdir(path.join(testDir, '2'), {recursive: true});
  });

  afterAll(async () => {
    // Clean up test directories
    await fs.rm(testDir, {recursive: true, force: true});
  });

  test('should edit multiple files in allowed directory using OpenAI', async () => {
    // Create test files with initial content
    const file1Path = path.join(testDir, '1', 'file1.js');
    const file2Path = path.join(testDir, '1', 'file2.js');
    const file3Path = path.join(testDir, '1', 'file3.js');
    const file4Path = path.join(testDir, '1', 'file4.js');
    const file5Path = path.join(testDir, '1', 'file5.js');

    await fs.writeFile(file1Path, 'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));');
    await fs.writeFile(
      file2Path,
      'function subtract(a, b) { return a - b; }\nconsole.log(subtract(5, 3));',
    );
    await fs.writeFile(
      file3Path,
      'function divide(a, b) { return a / b; }\nconsole.log(divide(10, 2));',
    );
    await fs.writeFile(
      file4Path,
      'function power(a, b) { return Math.pow(a, b); }\nconsole.log(power(2, 3));',
    );
    await fs.writeFile(
      file5Path,
      'function modulo(a, b) { return a % b; }\nconsole.log(modulo(10, 3));',
    );

    fileEditTool = new FileEditTool(
      testDir,
      [path.join(testDir, '1')],
      model,
      AI_PROVIDERS.OPENAI,
      process.env.OPENAI_API_KEY || '',
      [
        path.join(testDir, '1', 'file1.js'),
        path.join(testDir, '1', 'file2.js'),
        path.join(testDir, '1', 'file3.js'),
        path.join(testDir, '1', 'file4.js'),
        path.join(testDir, '1', 'file5.js'),
      ],
    );

    // Test editing multiple files in allowed directory using OpenAI
    const response = await fileEditTool.processQuery(
      `Please modify all five JavaScript files to use multiplication operations instead of their current operations.
       In file1.js, replace the add function with multiply and update its implementation to use * operator.
       In file2.js, replace the subtract function with multiply and update its implementation to use * operator.
       In file3.js, replace the divide function with multiply and update its implementation to use * operator.
       In file4.js, replace the power function with multiply and update its implementation to use * operator.
       In file5.js, replace the modulo function with multiply and update its implementation to use * operator.
       Keep the same function parameters and console.log statements, just change the operation.`,
    );

    // Check the response contains expected diffs for all three files
    expect(response.rawDiff).toBeDefined();
    expect(response.reverseDiff).toBeDefined();

    // Check rawDiff for each file
    expect(response.rawDiff?.[file1Path]).toContain('-function add(a, b)');
    expect(response.rawDiff?.[file1Path]).toContain('+function multiply(a, b)');

    expect(response.rawDiff?.[file2Path]).toContain('-function subtract(a, b)');
    expect(response.rawDiff?.[file2Path]).toContain('+function multiply(a, b)');

    expect(response.rawDiff?.[file3Path]).toContain('-function divide(a, b)');
    expect(response.rawDiff?.[file3Path]).toContain('+function multiply(a, b)');

    expect(response.rawDiff?.[file4Path]).toContain('-function power(a, b)');
    expect(response.rawDiff?.[file4Path]).toContain('+function multiply(a, b)');

    expect(response.rawDiff?.[file5Path]).toContain('-function modulo(a, b)');
    expect(response.rawDiff?.[file5Path]).toContain('+function multiply(a, b)');

    // Check reverseDiff for each file (should be the opposite of rawDiff)
    expect(response.reverseDiff?.[file1Path]).toContain('-function multiply(a, b)');
    expect(response.reverseDiff?.[file1Path]).toContain('+function add(a, b)');

    expect(response.reverseDiff?.[file2Path]).toContain('-function multiply(a, b)');
    expect(response.reverseDiff?.[file2Path]).toContain('+function subtract(a, b)');

    expect(response.reverseDiff?.[file3Path]).toContain('-function multiply(a, b)');
    expect(response.reverseDiff?.[file3Path]).toContain('+function divide(a, b)');

    expect(response.reverseDiff?.[file4Path]).toContain('-function multiply(a, b)');
    expect(response.reverseDiff?.[file4Path]).toContain('+function power(a, b)');

    expect(response.reverseDiff?.[file5Path]).toContain('-function multiply(a, b)');
    expect(response.reverseDiff?.[file5Path]).toContain('+function modulo(a, b)');

    // console.log('Tool results:', response.toolResults.join('\n'));
    expect(response.finalText.join('\n')).toContain('Successfully updated file');
    expect(response.finalStatus).toBe('success');
    expect(response.toolCallRounds).toBeLessThanOrEqual(2);
    expect(response.toolCallCount).toBeGreaterThanOrEqual(5);
    expect(response.toolCallCount).toBeLessThanOrEqual(6);

    // Verify the files were edited correctly
    const file1Content = await fs.readFile(file1Path, 'utf-8');
    const file2Content = await fs.readFile(file2Path, 'utf-8');
    const file3Content = await fs.readFile(file3Path, 'utf-8');
    const file4Content = await fs.readFile(file4Path, 'utf-8');
    const file5Content = await fs.readFile(file5Path, 'utf-8');

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

    // Check file4
    expect(file4Content).toContain('function multiply(a, b)');
    expect(file4Content).toContain('a * b');
    expect(file4Content).toContain('console.log(multiply(2, 3));');
    expect(file4Content).not.toContain('function power(a, b)');
    expect(file4Content).not.toContain('Math.pow(a, b)');
    expect(file4Content).not.toContain('console.log(power(2, 3));');

    // Check file5
    expect(file5Content).toContain('function multiply(a, b)');
    expect(file5Content).toContain('a * b');
    expect(file5Content).toContain('console.log(multiply(10, 3));');
    expect(file5Content).not.toContain('function modulo(a, b)');
    expect(file5Content).not.toContain('a % b');
    expect(file5Content).not.toContain('console.log(modulo(10, 3));');
  });
});
