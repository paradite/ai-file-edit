import {MCPClient} from '../index';
import fs from 'fs/promises';
import path from 'path';

describe.skip('MCP File Edit', () => {
  let mcpClient: MCPClient;
  const testDir = path.join(process.cwd(), 'sample');
  const serverScriptPath = './servers/filesystem/dist/index.js';

  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(path.join(testDir, '1'), {recursive: true});
    await fs.mkdir(path.join(testDir, '2'), {recursive: true});

    // Create test files
    await fs.writeFile(path.join(testDir, '1', 'script.js'), 'console.log("Test 1");');
    await fs.writeFile(path.join(testDir, '2', 'script.js'), 'console.log("Test 2");');
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

  test('should allow access to allowed directory and deny access to non-allowed directory', async () => {
    // Connect to server with only test directory 1 allowed
    await mcpClient.connectToServer(serverScriptPath, [path.join(testDir, '1')]);

    // Test reading file content from allowed directory
    const response1 = await mcpClient.processQuery(
      `read the content of file ${path.join(testDir, '1', 'script.js')}`,
    );
    expect(response1).toContain('Test 1');

    // Test reading file content from non-allowed directory
    const response2 = await mcpClient.processQuery(
      `read the content of file ${path.join(testDir, '2', 'script.js')}`,
    );
    expect(response2).toContain('Error: Access denied');
    expect(response2).toContain('path outside allowed directories');
    expect(response2).not.toContain('Test 2');
  });

  test('should handle invalid file paths', async () => {
    await mcpClient.connectToServer(serverScriptPath, [path.join(testDir, '1')]);

    const response = await mcpClient.processQuery(
      `read the content of file ${path.join(testDir, '1', 'nonexistent.js')}`,
    );
    expect(response).toContain('ENOENT');
    expect(response).toContain('no such file or directory');
  });
});
