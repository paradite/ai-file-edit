import {FileEditTool} from '../index';
import fs from 'fs/promises';
import path from 'path';
import {ModelEnum} from 'llm-info';

describe('File Edit Tool with Claude - Multiple Files', () => {
  let fileEditTool: FileEditTool;
  const testDir = path.join(process.cwd(), 'sample-claude-multiple');

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

  test('should edit multiple files in allowed directory', async () => {
    // Create test files with initial content
    const file1Path = path.join(testDir, '1', 'file1.js');
    const file2Path = path.join(testDir, '1', 'file2.js');

    await fs.writeFile(file1Path, 'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));');
    await fs.writeFile(
      file2Path,
      'function subtract(a, b) { return a - b; }\nconsole.log(subtract(5, 3));',
    );

    // Test editing multiple files in allowed directory
    const response = await fileEditTool.processQuery(
      `update both ${file1Path} and ${file2Path} to change the arithmetic operations to multiplication. 
       In ${file1Path}, change add to multiply and update the function calls.
       In ${file2Path}, change subtract to multiply and update the function calls.`,
      ModelEnum['claude-3-5-sonnet-20241022'],
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));
    console.log('Final status:', response.finalStatus);
    expect(response.finalText.join('\n')).toContain('Successfully updated file');
    expect(response.finalStatus).toBe('success');

    // Verify the files were edited correctly
    const file1Content = await fs.readFile(file1Path, 'utf-8');
    const file2Content = await fs.readFile(file2Path, 'utf-8');

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
  });

  test('should handle mixed allowed and non-allowed files', async () => {
    // Create test files with initial content
    const allowedPath = path.join(testDir, '1', 'file1.js');
    const nonAllowedPath = path.join(testDir, '2', 'file2.js');

    await fs.writeFile(
      allowedPath,
      'function add(a, b) { return a + b; }\nconsole.log(add(1, 2));',
    );
    await fs.writeFile(
      nonAllowedPath,
      'function subtract(a, b) { return a - b; }\nconsole.log(subtract(5, 3));',
    );

    // Test editing both allowed and non-allowed files
    const response = await fileEditTool.processQuery(
      `update both ${allowedPath} and ${nonAllowedPath} to change the arithmetic operations to multiplication. 
       In ${allowedPath}, change add to multiply and update the function calls.
       In ${nonAllowedPath}, change subtract to multiply and update the function calls.`,
      ModelEnum['claude-3-5-sonnet-20241022'],
    );
    console.log('Tool results:', response.toolResults.join('\n'));
    console.log('Response:', response.finalText.join('\n'));
    console.log('Final status:', response.finalStatus);

    // Verify only the allowed file was edited
    const allowedContent = await fs.readFile(allowedPath, 'utf-8');
    const nonAllowedContent = await fs.readFile(nonAllowedPath, 'utf-8');

    // Check allowed file was edited
    expect(allowedContent).toContain('function multiply(a, b)');
    expect(allowedContent).toContain('a * b');
    expect(allowedContent).toContain('console.log(multiply(1, 2));');

    // Check non-allowed file was not edited
    expect(nonAllowedContent).toContain('function subtract(a, b)');
    expect(nonAllowedContent).toContain('a - b');
    expect(nonAllowedContent).toContain('console.log(subtract(5, 3));');
  });
});
