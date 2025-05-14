import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

const model = ModelEnum['claude-3-7-sonnet-20250219'];

// jest.retryTimes(1);

describe('File Edit Tool with Claude', () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-claude');

  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(path.join(testDir, '1'), {recursive: true});
    await fs.mkdir(path.join(testDir, '2'), {recursive: true});
  });

  afterAll(async () => {
    // Clean up test directories
    await fs.rm(testDir, {recursive: true, force: true});
  });

  test('should allow editing files in allowed directory', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, '1', 'edit-test.js');
    await fs.writeFile(
      testFilePath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    fileEditTool = new FileEditTool(
      testDir,
      [path.join(testDir, '1')],
      {
        provider: AI_PROVIDERS.ANTHROPIC,
        model: model,
        apiKey: process.env.ANTHROPIC_API_KEY || '',
      },
      [path.join(testDir, '1', 'edit-test.js')],
      3,
    );

    // Test editing file in allowed directory
    const response = await fileEditTool.processQuery(
      `update ${testFilePath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
    );
    expect(response.finalText.join('\n')).toContain('Successfully updated file');
    expect(response.finalStatus).toBe('success');
    expect(response.toolCallCount).toBeGreaterThanOrEqual(1);
    expect(response.toolCallCount).toBeLessThanOrEqual(2);

    // Verify the file was edited correctly
    const editedContent = await fs.readFile(testFilePath, 'utf-8');
    expect(editedContent).toContain('function multiply(a, b)');
    expect(editedContent).toContain('a * b');
    expect(editedContent).toContain('console.log(multiply(1, 2));');

    expect(editedContent).not.toContain('function add(a, b)');
    expect(editedContent).not.toContain('a + b');
    expect(editedContent).not.toContain('console.log(add(1, 2));');
  });
});
