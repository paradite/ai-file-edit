import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

const model = ModelEnum['gpt-4.1'];

describe('File Edit Tool Access Control', () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-access');

  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(path.join(testDir, '1'), {recursive: true});
    await fs.mkdir(path.join(testDir, '2'), {recursive: true});
  });

  afterAll(async () => {
    // Clean up test directories
    await fs.rm(testDir, {recursive: true, force: true});
  });

  test('should deny access to non-allowed directory using OpenAI', async () => {
    // Create a test file in non-allowed directory
    const nonAllowedPath = path.join(testDir, '2', 'edit-test-openai.js');
    await fs.writeFile(
      nonAllowedPath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    fileEditTool = new FileEditTool(
      testDir,
      [path.join(testDir, '1')],
      {
        provider: AI_PROVIDERS.OPENAI,
        model: model,
        apiKey: process.env.OPENAI_API_KEY || '',
      },
      [path.join(testDir, '1', 'edit-test-openai.js')],
      3,
    );

    // Test editing file in non-allowed directory using OpenAI
    const response = await fileEditTool.processQuery(
      `update ${nonAllowedPath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
    );

    // Verify the file was not edited
    const editedContent = await fs.readFile(nonAllowedPath, 'utf-8');
    expect(editedContent).toContain('function add(a, b)');
    expect(editedContent).toContain('console.log(add(1, 2));');
  });

  test('should create new file in allowed directory using OpenAI', async () => {
    // Define path for new file
    const newFilePath = path.join(testDir, '1', 'new-file-openai.js');

    fileEditTool = new FileEditTool(
      testDir,
      [path.join(testDir, '1')],
      {
        provider: AI_PROVIDERS.OPENAI,
        model: model,
        apiKey: process.env.OPENAI_API_KEY || '',
      },
      [path.join(testDir, '1', 'edit-test-openai.js')],
      3,
    );

    // Test creating a new file using OpenAI
    const response = await fileEditTool.processQuery(
      `create new file ${newFilePath} with content: function greet(name) { return "Hello, " + name; }`,
    );
    expect(response.finalText.join('\n')).toContain('Successfully created file');
    expect(response.finalStatus).toBe('success');
    expect(response.toolCallCount).toBeGreaterThanOrEqual(1);
    expect(response.toolCallCount).toBeLessThanOrEqual(2);

    // Verify the file was created with correct content
    const fileContent = await fs.readFile(newFilePath, 'utf-8');
    const fileWithoutNewlines = fileContent.replace(/\r\n/g, '').replace(/\n/g, '');
    expect(fileWithoutNewlines).toEqual(`function greet(name) { return "Hello, " + name; }`);
  });
});
