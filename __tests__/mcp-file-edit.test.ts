import {MCPClient} from '../index';
import fs from 'fs/promises';
import path from 'path';

describe('MCP File Edit', () => {
  let mcpClient: MCPClient;
  const testDir = path.join(process.cwd(), 'sample');
  const serverScriptPath = './servers/filesystem/dist/index.js';

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

  test('should allow editing files in allowed directory', async () => {
    // Create a test file with initial content
    const testFilePath = path.join(testDir, '1', 'edit-test.js');
    await fs.writeFile(
      testFilePath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    // Connect to server with only test directory 1 allowed
    await mcpClient.connectToServer(serverScriptPath, [path.join(testDir, '1')]);

    // Test editing file in allowed directory
    const response = await mcpClient.processQuery(
      `update ${testFilePath} to change add to multiply, update function calls as well`,
    );
    expect(response).toContain('Successfully updated file');

    // Verify the file was edited correctly
    const editedContent = await fs.readFile(testFilePath, 'utf-8');
    expect(editedContent).toContain('function multiply(a, b)');
    expect(editedContent).toContain('console.log(multiply(1, 2));');
  });

  test('should deny access to non-allowed directory', async () => {
    // Create a test file in non-allowed directory
    const nonAllowedPath = path.join(testDir, '2', 'edit-test.js');
    await fs.writeFile(
      nonAllowedPath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );

    // Connect to server with only test directory 1 allowed
    await mcpClient.connectToServer(serverScriptPath, [path.join(testDir, '1')]);

    // Test editing file in non-allowed directory
    await mcpClient.processQuery(`update ${nonAllowedPath} to change add to multiply`);

    // Verify the file was not edited
    const editedContent = await fs.readFile(nonAllowedPath, 'utf-8');
    expect(editedContent).toContain('function add(a, b)');
    expect(editedContent).toContain('console.log(add(1, 2));');
  });
});
