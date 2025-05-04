# AI File Edit

[![npm](https://img.shields.io/npm/v/ai-file-edit)](https://www.npmjs.com/package/ai-file-edit)

A library for editing files using AI models (Claude and OpenAI), developed for [16x Prompt](https://prompt.16x.engineer/).

This library allows you to make file edits using natural language instructions.

## Features

- Edit files using natural language
- Create new files
- Overwrite existing files
- Make selective edits to files
- Generate diffs for all changes
- Generate reverse diffs for reverting changes
- Support for both OpenAI and Anthropic models
- Secure file access with allowed directories
- Automatic file content refresh
- Support for multiple tool use rounds
- Support for multiple AI providers (Anthropic, OpenAI)
- Automatic file content refresh after edits
- Git-style diffs for tracking changes
- Support for multiple file edits in a single operation
- Ability to revert changes using reverse diffs

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
  5, // Optional: Maximum number of tool use rounds (default: 3)
);

// Initialize the tool with GPT
const gptFileEditTool = new FileEditTool(
  ['/path/to/allowed/directory'],
  ModelEnum['gpt-4.1'],
  AI_PROVIDERS.OPENAI,
  process.env.OPENAI_API_KEY,
  ['/path/to/file1.js', '/path/to/file2.js'],
  5, // Optional: Maximum number of tool use rounds (default: 3)
);
```

### Basic Usage

```typescript
import {FileEditTool} from 'ai-file-edit';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

const fileEditTool = new FileEditTool(
  ['/path/to/allowed/directory'],
  ModelEnum['claude-3-7-sonnet-20250219'],
  AI_PROVIDERS.ANTHROPIC,
  'your-api-key',
  ['/path/to/file/to/edit'],
);

const response = await fileEditTool.processQuery('Update the file to add a new function');
console.log(response.finalText);
console.log(response.toolResults);
console.log(response.rawDiff);
console.log(response.reverseDiff);
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

### File Context

You can provide a list of files to include in the context of the query. This is useful when you want to reference multiple files in your query:

```typescript
const fileEditTool = new FileEditTool(
  ['/path/to/allowed/directory'],
  ModelEnum['claude-3-7-sonnet-20250219'],
  AI_PROVIDERS.ANTHROPIC,
  'your-api-key',
  ['/path/to/file1.js', '/path/to/file2.js'],
);
```

### Tool Use Rounds

The tool supports multiple rounds of tool use, allowing the model to make multiple changes in response to a single query. The maximum number of rounds is configurable through the `maxToolUseRounds` parameter in the constructor:

```typescript
const fileEditTool = new FileEditTool(
  ['/path/to/allowed/directory'],
  ModelEnum['claude-3-7-sonnet-20250219'],
  AI_PROVIDERS.ANTHROPIC,
  'your-api-key',
  ['/path/to/file1.js', '/path/to/file2.js'],
  5, // Maximum number of tool use rounds
);
```

If not specified, the default value is 3 rounds.

## Response Structure

The `processQuery` method returns an object with the following structure:

```ts
{
  finalText: string[];      // Array of text responses from the AI
  toolResults: string[];    // Array of results from tool operations
  finalStatus: 'success' | 'failure' | 'retry_limit_reached' | 'no_tool_calls';
  toolCallCount: number;    // Number of tool calls made
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

## Security Considerations

- The library only allows file operations within specified allowed directories
- API keys should be stored securely and not hardcoded
- File paths are validated before any operations are performed

## Testing

The library includes test cases for both Claude and GPT models. To run the tests:

```bash
npm test
```

## API

### FileEditTool

#### Constructor

```typescript
import {ModelEnum, AI_PROVIDERS} from 'llm-info';

constructor(
  allowedDirectories: string[],
  modelName: ModelEnum,
  provider: AI_PROVIDER_TYPE,
  apiKey: string,
  fileContext: string[] = [],
  maxToolUseRounds: number = 3,
)
```

Parameters:

- `allowedDirectories`: Array of directories where file operations are allowed
- `modelName`: The AI model to use (from ModelEnum)
- `provider`: The AI provider (from AI_PROVIDERS)
- `apiKey`: Your API key for the AI provider
- `fileContext`: Optional array of file paths to include in the context
- `maxToolUseRounds`: Optional maximum number of tool use rounds (default: 3)

#### Methods

##### processQuery

```typescript
async processQuery(query: string): Promise<{
  finalText: string[];
  toolResults: string[];
  finalStatus: ToolCallStatus;
  toolCallCount: number;
  rawDiff?: string;
  reverseDiff?: string;
}>
```

Processes a natural language query and returns the results.

- `query`: The natural language query to process
- Returns:
  - `finalText`: The final text response from the model
  - `toolResults`: The results of any tool calls made
  - `finalStatus`: The final status of the tool calls
  - `toolCallCount`: The number of tool calls made
  - `rawDiff`: The forward diff showing the changes made
  - `reverseDiff`: The reverse diff for reverting changes

## Security

The tool enforces security by:

1. Only allowing access to files within the specified allowed directories
2. Validating file paths to prevent directory traversal attacks
3. Handling symlinks safely by checking their real paths
4. Verifying parent directories for new files

## License

MIT

## Diffs

The tool provides both raw and reverse diffs in a git-style format. The diffs are returned as a record where:

- The key is the file path
- The value is the diff content

Example diff format:

```diff
Index: /path/to/file.js
===================================================================
--- /path/to/file.js original
+++ /path/to/file.js modified
@@ -1,2 +1,2 @@
-function add(a, b) { return a + b; }
-console.log(add(1, 2));
+function multiply(a, b) { return a * b; }
+console.log(multiply(1, 2));
```

The raw diff shows the changes made to the file, while the reverse diff shows how to revert those changes. This allows you to:

1. Track what changes were made to each file
2. Revert changes if needed using the reverse diff
3. Reapply changes using the raw diff
