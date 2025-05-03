import {MCPClient} from '../index';
import fs from 'fs/promises';
import path from 'path';

describe('MCP File Edit with OpenAI', () => {
  let mcpClient: MCPClient;
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
    mcpClient = new MCPClient();
  });

  afterEach(async () => {
    await mcpClient.cleanup();
  });

  test('should allow editing files in allowed directory using OpenAI', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, '1', 'edit-test-openai.js');
    await fs.writeFile(
      testFilePath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    // Connect to server with only test directory 1 allowed
    await mcpClient.connectToServer([path.join(testDir, '1')]);

    // Test editing file in allowed directory using OpenAI
    const response = await mcpClient.processQuery(
      `update ${testFilePath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
      true,
    );
    console.log('Tool results:', response.toolResults);
    console.log('Response:', response.finalText);
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

    // Connect to server with only test directory 1 allowed
    await mcpClient.connectToServer([path.join(testDir, '1')]);

    // Test editing file in non-allowed directory using OpenAI
    const response = await mcpClient.processQuery(
      `update ${nonAllowedPath} to change add to multiply, update both the function definition and the function calls add(1,2) to multiply(1,2)`,
      true,
    );
    console.log('Tool results:', response.toolResults);
    console.log('Response:', response.finalText);

    // Verify the file was not edited
    const editedContent = await fs.readFile(nonAllowedPath, 'utf-8');
    expect(editedContent).toContain('function add(a, b)');
    expect(editedContent).toContain('console.log(add(1, 2));');
  });

  test('should create new file in allowed directory using OpenAI', async () => {
    // Connect to server with test directory 1 allowed
    await mcpClient.connectToServer([path.join(testDir, '1')]);

    // Define path for new file
    const newFilePath = path.join(testDir, '1', 'new-file-openai.js');

    // Test creating a new file using OpenAI
    const response = await mcpClient.processQuery(
      `create new file ${newFilePath} with content: function greet(name) { return "Hello, " + name; }`,
      true,
    );
    console.log('Tool results:', response.toolResults);
    console.log('Response:', response.finalText);
    expect(response.finalText.join('\n')).toContain('Successfully created file');

    // Verify the file was created with correct content
    const fileContent = await fs.readFile(newFilePath, 'utf-8');
    const fileWithoutNewlines = fileContent.replace(/\r\n/g, '').replace(/\n/g, '');
    console.log('File content:', fileWithoutNewlines);
    expect(fileWithoutNewlines).toEqual(`function greet(name) { return "Hello, " + name; }`);
  });
});
