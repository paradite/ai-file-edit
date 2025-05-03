import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';

describe('File Edit Tool with OpenAI', () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-openai');

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

  test('should allow editing files in allowed directory using OpenAI', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, '1', 'edit-test-openai.js');
    await fs.writeFile(
      testFilePath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    // Test editing file in allowed directory using OpenAI
    const response = await fileEditTool.processQuery(
      `update ${testFilePath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
      true,
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));
    expect(response.finalText.join('\n')).toContain('Successfully updated file');

    // Verify the file was edited correctly
    const editedContent = await fs.readFile(testFilePath, 'utf-8');
    expect(editedContent).toContain('function multiply(a, b)');
    expect(editedContent).toContain('a * b');
    expect(editedContent).toContain('console.log(multiply(1, 2));');

    expect(editedContent).not.toContain('function add(a, b)');
    expect(editedContent).not.toContain('a + b');
    expect(editedContent).not.toContain('console.log(add(1, 2));');
  });

  test('should deny access to non-allowed directory using OpenAI', async () => {
    // Create a test file in non-allowed directory
    const nonAllowedPath = path.join(testDir, '2', 'edit-test-openai.js');
    await fs.writeFile(
      nonAllowedPath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    // Test editing file in non-allowed directory using OpenAI
    const response = await fileEditTool.processQuery(
      `update ${nonAllowedPath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
      true,
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));

    // Verify the file was not edited
    const editedContent = await fs.readFile(nonAllowedPath, 'utf-8');
    expect(editedContent).toContain('function add(a, b)');
    expect(editedContent).toContain('console.log(add(1, 2));');
  });

  test('should create new file in allowed directory using OpenAI', async () => {
    // Define path for new file
    const newFilePath = path.join(testDir, '1', 'new-file-openai.js');

    // Test creating a new file using OpenAI
    const response = await fileEditTool.processQuery(
      `create new file ${newFilePath} with content: function greet(name) { return "Hello, " + name; }`,
      true,
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));
    expect(response.finalText.join('\n')).toContain('Successfully created file');

    // Verify the file was created with correct content
    const fileContent = await fs.readFile(newFilePath, 'utf-8');
    const fileWithoutNewlines = fileContent.replace(/\r\n/g, '').replace(/\n/g, '');
    expect(fileWithoutNewlines).toEqual(`function greet(name) { return "Hello, " + name; }`);
  });
});
