# AI File Edit

[![npm](https://img.shields.io/npm/v/ai-file-edit)](https://www.npmjs.com/package/ai-file-edit)

A library for editing files using AI models (Claude and OpenAI), developed for [16x Prompt](https://prompt.16x.engineer/).

This library allows you to make file edits using natural language instructions.

## Features

File Operations

- Edit files using natural language
- Create new files
- Overwrite existing files
- Make selective edits to files
- Support for multiple file edits in a single operation

AI Integration

- Support for OpenAI, Anthropic, and Google AI models
- Support for multiple tool use rounds
- Debug mode for detailed logging

Version Control & Safety

- Generate diffs for all changes
- Generate reverse diffs for reverting changes
- Ability to revert changes using reverse diffs

Security

- Secure file access with allowed directories
- API key security
- File path validation
- Safe symlink handling

## Supported Models

```typescript
import {SUPPORTED_MODELS} from 'ai-file-edit';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

// Print all supported models
console.log(SUPPORTED_MODELS);

// Example output:
[
  {
    model: ModelEnum['gpt-4.1'],
    provider: AI_PROVIDERS.OPENAI,
    recommended: true,
    supportMultipleEditsPerMessage: true,
  },
  {
    model: ModelEnum['claude-3-7-sonnet-20250219'],
    provider: AI_PROVIDERS.ANTHROPIC,
    recommended: false,
    supportMultipleEditsPerMessage: false,
  },
  {
    model: ModelEnum['gemini-2.5-pro-preview-05-06'],
    provider: AI_PROVIDERS.GOOGLE,
    recommended: false,
    supportMultipleEditsPerMessage: true,
  },
  {
    model: ModelEnum['gemini-2.5-pro-exp-03-25'],
    provider: AI_PROVIDERS.GOOGLE,
    recommended: false,
    supportMultipleEditsPerMessage: true,
  },
];
```

Note: The recommended model is `gpt-4.1` as it provides the best performance for file editing tasks.

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
  '/path/to/parent/directory', // Parent directory for relative paths
  ['/path/to/allowed/directory'], // Allowed directories for file operations
  ModelEnum['claude-3-7-sonnet-20250219'],
  AI_PROVIDERS.ANTHROPIC,
  process.env.ANTHROPIC_API_KEY,
  ['/path/to/file1.js', '/path/to/file2.js'], // Optional: Files to include in context
  5, // Optional: Maximum number of tool use rounds (default: 5)
);

// Initialize the tool with GPT
const gptFileEditTool = new FileEditTool(
  '/path/to/parent/directory', // Parent directory for relative paths
  ['/path/to/allowed/directory'], // Allowed directories for file operations
  ModelEnum['gpt-4.1'],
  AI_PROVIDERS.OPENAI,
  process.env.OPENAI_API_KEY,
  ['/path/to/file1.js', '/path/to/file2.js'], // Optional: Files to include in context
  5, // Optional: Maximum number of tool use rounds (default: 5)
);

// Initialize the tool with Google AI
const googleFileEditTool = new FileEditTool(
  '/path/to/parent/directory', // Parent directory for relative paths
  ['/path/to/allowed/directory'], // Allowed directories for file operations
  ModelEnum['gemini-2.5-pro-preview-05-06'],
  AI_PROVIDERS.GOOGLE,
  process.env.GOOGLE_API_KEY,
  ['/path/to/file1.js', '/path/to/file2.js'], // Optional: Files to include in context
  5, // Optional: Maximum number of tool use rounds (default: 5)
);
```

### Basic Usage

```typescript
import {FileEditTool} from 'ai-file-edit';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

const fileEditTool = new FileEditTool(
  '/path/to/parent/directory', // Parent directory for relative paths
  ['/path/to/allowed/directory'], // Allowed directories for file operations
  ModelEnum['claude-3-7-sonnet-20250219'],
  AI_PROVIDERS.ANTHROPIC,
  'your-api-key',
  ['/path/to/file/to/edit'], // Optional: Files to include in context
);

// Process query with debug mode enabled
const response = await fileEditTool.processQuery('Update the file to add a new function', true);
console.log(response.finalText);
console.log(response.toolResults);
console.log(response.rawDiff);
console.log(response.reverseDiff);
console.log(response.toolCallRounds);
```

### Diffs and Reverting Changes

The tool generates both forward and reverse diffs for all file changes. The forward diff shows what was changed, while the reverse diff can be used to revert the changes.

#### Forward Diff

The forward diff is returned in the `rawDiff` field of the response. It shows the changes made to the file in a git-style diff format:

```diff
--- file.js original
+++ file.js modified
@@ -1,2 +1,2 @@
-function add(a, b) { return a + b; }
-console.log(add(1, 2));
+function multiply(a, b) { return a * b; }
+console.log(multiply(1, 2));
```

#### Reverse Diff

The reverse diff is returned in the `reverseDiff` field of the response. It shows how to revert the changes in a git-style diff format:

```diff
--- file.js modified
+++ file.js original
@@ -1,2 +1,2 @@
-function multiply(a, b) { return a * b; }
-console.log(multiply(1, 2));
+function add(a, b) { return a + b; }
+console.log(add(1, 2));
```

#### Reverting Changes

You can use the reverse diff to revert changes using the `applyReversePatch` function:

```typescript
import {applyReversePatch} from 'ai-file-edit';

// Apply the reverse patch to revert changes
const result = await applyReversePatch(filePath, reverseDiff);
if (result.success) {
  console.log('Changes reverted successfully');
} else {
  console.error('Failed to revert changes:', result.error);
}
```

The `applyReversePatch` function returns a promise that resolves to an object with:

- `success`: boolean indicating whether the operation was successful
- `error`: optional string containing error message if the operation failed

### File Context and Tool Use Rounds

You can provide a list of files to include in the context of the query. This is useful when you want to reference multiple files in your query:

```typescript
const fileEditTool = new FileEditTool(
  '/path/to/parent/directory',
  ['/path/to/allowed/directory'],
  ModelEnum['claude-3-7-sonnet-20250219'],
  AI_PROVIDERS.ANTHROPIC,
  'your-api-key',
  ['/path/to/file1.js', '/path/to/file2.js'],
  5, // Maximum number of tool use rounds (default: 5)
);
```

The tool supports multiple rounds of tool use, allowing the model to make multiple changes in response to a single query. The maximum number of rounds is configurable through the `maxToolUseRounds` parameter in the constructor.

### Debug Mode

The `processQuery` method supports an optional debug mode that provides detailed logging of the tool's operation:

```typescript
const response = await fileEditTool.processQuery('Update the file to add a new function', true);
```

When debug mode is enabled, the tool will log:

- The initial query
- Each tool call round
- The message history
- Tool call processing details
- Response details

This is useful for debugging and understanding how the tool processes queries and makes changes.

## Response Structure

The `processQuery` method returns an object with the following structure:

```ts
{
  finalText: string[];      // Array of text responses from the AI
  toolResults: string[];    // Array of results from tool operations
  finalStatus: 'success' | 'failure' | 'retry_limit_reached' | 'no_tool_calls';
  toolCallCount: number;    // Number of tool calls made
  toolCallRounds: number;   // Number of tool call rounds used
  rawDiff?: Record<string, string>;    // Forward diffs for each file, keyed by file path
  reverseDiff?: Record<string, string>; // Reverse diffs for each file, keyed by file path
}
```

Example response with diffs:

```ts
{
  finalText: ["Successfully updated files"],
  toolResults: ["File updated successfully"],
  finalStatus: "success",
  toolCallCount: 1,
  toolCallRounds: 1,
  rawDiff: {
    "/path/to/file1.js": "Index: /path/to/file1.js\n...",
    "/path/to/file2.js": "Index: /path/to/file2.js\n..."
  },
  reverseDiff: {
    "/path/to/file1.js": "Index: /path/to/file1.js\n...",
    "/path/to/file2.js": "Index: /path/to/file2.js\n..."
  }
}
```

## Limitations

- Cannot delete files
- Cannot edit too many files at once (> 3 files)

## Testing

The library includes test cases for both Claude and GPT models. To run the tests:

```bash
npm test
```

## License

MIT
