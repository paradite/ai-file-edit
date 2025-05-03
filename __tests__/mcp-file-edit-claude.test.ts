import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum} from 'llm-info';

const model = ModelEnum['claude-3-7-sonnet-20250219'];

jest.retryTimes(3);

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

  beforeEach(() => {
    fileEditTool = new FileEditTool([path.join(testDir, '1')]);
  });

  test('should allow editing files in allowed directory', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, '1', 'edit-test.js');
    await fs.writeFile(
      testFilePath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    // Test editing file in allowed directory
    const response = await fileEditTool.processQuery(
      `update ${testFilePath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
      model,
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));
    console.log('Final status:', response.finalStatus);
    expect(response.finalText.join('\n')).toContain('Successfully updated file');
    expect(response.finalStatus).toBe('success');

    // Verify the file was edited correctly
    const editedContent = await fs.readFile(testFilePath, 'utf-8');
    expect(editedContent).toContain('function multiply(a, b)');
    expect(editedContent).toContain('a * b');
    expect(editedContent).toContain('console.log(multiply(1, 2));');

    expect(editedContent).not.toContain('function add(a, b)');
    expect(editedContent).not.toContain('a + b');
    expect(editedContent).not.toContain('console.log(add(1, 2));');
  });

  test('should deny access to non-allowed directory', async () => {
    // Create a test file in non-allowed directory
    const nonAllowedPath = path.join(testDir, '2', 'edit-test.js');
    await fs.writeFile(
      nonAllowedPath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    // Test editing file in non-allowed directory
    const response = await fileEditTool.processQuery(
      `update ${nonAllowedPath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
      model,
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));
    console.log('Final status:', response.finalStatus);

    // Verify the file was not edited
    const editedContent = await fs.readFile(nonAllowedPath, 'utf-8');
    expect(editedContent).toContain('function add(a, b)');
    expect(editedContent).toContain('console.log(add(1, 2));');
  });

  test('should create new file in allowed directory', async () => {
    // Define path for new file
    const newFilePath = path.join(testDir, '1', 'new-file.js');

    // Test creating a new file
    const response = await fileEditTool.processQuery(
      `create new file ${newFilePath} with content: function greet(name) { return "Hello, " + name; }`,
      model,
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));
    console.log('Final status:', response.finalStatus);
    expect(response.finalText.join('\n')).toContain('Successfully created file');
    expect(response.finalStatus).toBe('success');

    // Verify the file was created with correct content
    const fileContent = await fs.readFile(newFilePath, 'utf-8');
    const fileWithoutNewlines = fileContent.replace(/\r\n/g, '').replace(/\n/g, '');
    expect(fileWithoutNewlines).toEqual(`function greet(name) { return "Hello, " + name; }`);
  });
});
