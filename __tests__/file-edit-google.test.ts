import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

// const model = ModelEnum['gemini-2.5-pro-exp-03-25'];
const model = ModelEnum['gemini-2.5-pro'];

// jest.retryTimes(1);

describe(`File Edit Tool with Google Gemini, ${model}`, () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-google');

  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(path.join(testDir, '1'), {recursive: true});
    await fs.mkdir(path.join(testDir, '2'), {recursive: true});
  });

  afterAll(async () => {
    // Clean up test directories
    await fs.rm(testDir, {recursive: true, force: true});
  });

  test('should allow editing files in allowed directory using Google Gemini', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, '1', 'edit-test-gemini.js');
    await fs.writeFile(
      testFilePath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    fileEditTool = new FileEditTool(
      testDir,
      [path.join(testDir, '1')],
      {
        provider: AI_PROVIDERS.GOOGLE,
        model: model,
        apiKey: process.env.GEMINI_API_KEY || '',
      },
      [path.join(testDir, '1', 'edit-test-gemini.js')],
      3,
    );

    // Test editing file in allowed directory using Google Gemini
    const response = await fileEditTool.processQuery(
      `update ${testFilePath} to change add to multiply, update the function definition and implementation. Also update the function calls add(1,2) to multiply(1,2)`,
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

  test('should create new file in allowed directory using Google Gemini', async () => {
    // Define path for new file
    const newFilePath = path.join(testDir, '1', 'new-file-gemini.js');

    fileEditTool = new FileEditTool(
      testDir,
      [path.join(testDir, '1')],
      {
        provider: AI_PROVIDERS.GOOGLE,
        model: model,
        apiKey: process.env.GEMINI_API_KEY || '',
      },
      [path.join(testDir, '1', 'edit-test-gemini.js')],
      3,
    );

    // Test creating a new file using Google Gemini
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
