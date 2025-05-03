# AI File Edit

A library for editing files using AI models (Claude and GPT). This library allows you to make file edits using natural language instructions.

## Features

- Edit files using natural language instructions
- Support for both Claude and GPT models
- Multiple file editing in a single operation
- Safe file operations with directory restrictions
- Automatic function name and call site updates

## Installation

```bash
npm install ai-file-edit
```

## Usage

### Basic Setup

```ts
import {FileEditTool} from 'ai-file-edit';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

// Initialize the tool with Claude
const claudeFileEditTool = new FileEditTool(
  ['/path/to/allowed/directory'],
  ModelEnum['claude-3-7-sonnet-20250219'],
  AI_PROVIDERS.ANTHROPIC,
  process.env.ANTHROPIC_API_KEY,
  ['/path/to/file1.js', '/path/to/file2.js'],
);

// Initialize the tool with GPT
const gptFileEditTool = new FileEditTool(
  ['/path/to/allowed/directory'],
  ModelEnum['gpt-4.1'],
  AI_PROVIDERS.OPENAI,
  process.env.OPENAI_API_KEY,
  ['/path/to/file1.js', '/path/to/file2.js'],
);
```

### Making File Edits

```ts
// Using Claude
const claudeResponse = await claudeFileEditTool.processQuery(
  `update both /path/to/file1.js and /path/to/file2.js to change the arithmetic operations to multiplication. 
   In /path/to/file1.js, change add to multiply and update the function calls.
   In /path/to/file2.js, change subtract to multiply and update the function calls.`,
);

// Using GPT
const gptResponse = await gptFileEditTool.processQuery(
  `update both /path/to/file1.js and /path/to/file2.js to change the arithmetic operations to multiplication. 
   In /path/to/file1.js, change add to multiply and update the function calls.
   In /path/to/file2.js, change subtract to multiply and update the function calls.`,
);

// Check the response
console.log('Tool results:', claudeResponse.toolResults.join('\n'));
console.log('Response:', claudeResponse.finalText.join('\n'));
console.log('Final status:', claudeResponse.finalStatus);
console.log('Tool call count:', claudeResponse.toolCallCount);
```

### Example: Editing a Single File

```ts
// Using Claude
const claudeResponse = await claudeFileEditTool.processQuery(
  `update /path/to/file.js to change add to multiply, update function calls as well`,
);

// Using GPT
const gptResponse = await gptFileEditTool.processQuery(
  `update /path/to/file.js to change add to multiply, update function calls as well`,
);
```

## Response Structure

The `processQuery` method returns an object with the following structure:

```ts
{
  finalText: string[];      // Array of text responses from the AI
  toolResults: string[];    // Array of results from tool operations
  finalStatus: 'success' | 'failure' | 'retry_limit_reached' | 'no_tool_calls';
  toolCallCount: number;    // Number of tool calls made
}
```

## Security Considerations

- The library only allows file operations within specified allowed directories
- API keys should be stored securely and not hardcoded
- File paths are validated before any operations are performed

## Testing

The library includes test cases for both Claude and GPT models. To run the tests:

```bash
npm test
```
