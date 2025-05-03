#!/usr/bin/env node

import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {normalizePath, expandHome, validatePath, applyFileEdits} from './utils/fileUtils.js';

enum ToolName {
  EditFile = 'edit_file',
}

// Command line argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: mcp-server-filesystem <allowed-directory> [additional-directories...]');
  process.exit(1);
}

// Store allowed directories in normalized form
const allowedDirectories = args.map(dir => normalizePath(path.resolve(expandHome(dir))));

// Validate that all directories exist and are accessible
await Promise.all(
  args.map(async dir => {
    try {
      const stats = await fs.stat(expandHome(dir));
      if (!stats.isDirectory()) {
        console.error(`Error: ${dir} is not a directory`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error accessing directory ${dir}:`, error);
      process.exit(1);
    }
  }),
);

// Schema definitions
const EditOperation = z.object({
  oldText: z.string().describe('Text to search for - must match exactly. Can be multiple lines.'),
  newText: z.string().describe('Text to replace with. Can be multiple lines.'),
});

const EditFileArgsSchema = z.object({
  path: z.string(),
  content: z
    .string()
    .optional()
    .describe('Complete file content to write (for new files or complete overwrites)'),
  edits: z.array(EditOperation).optional().describe('List of edits to apply (for partial edits)'),
  dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format'),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// Server setup
const server = new Server(
  {
    name: 'secure-filesystem-server',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: ToolName.EditFile,
        description:
          'Create a new file, overwrite an existing file, or make selective edits to a file. ' +
          'For new files or complete overwrites, use the content parameter. ' +
          'For partial edits, use the edits parameter to specify text replacements. ' +
          'Note: content and edits parameters are mutually exclusive - use one or the other, not both. ' +
          'Returns a git-style diff showing the changes made. ' +
          'Only works within allowed directories.',
        inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const {name, arguments: args} = request.params;

    switch (name as ToolName) {
      case ToolName.EditFile: {
        const parsed = EditFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for edit_file: ${parsed.error}`);
        }
        if (parsed.data.content === undefined && parsed.data.edits === undefined) {
          throw new Error('Either content or edits must be provided');
        }
        if (parsed.data.content !== undefined && parsed.data.edits !== undefined) {
          throw new Error(
            'Cannot provide both content and edits - use content for complete file writes and edits for partial changes',
          );
        }
        const validPath = await validatePath(parsed.data.path, allowedDirectories);
        const result = await applyFileEdits(
          validPath,
          parsed.data.edits,
          parsed.data.content,
          parsed.data.dryRun,
        );
        return {
          content: [{type: 'text', text: result}],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{type: 'text', text: `Error: ${errorMessage}`}],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Secure MCP Filesystem Server running on stdio');
  console.error('Allowed directories:', allowedDirectories);
}

runServer().catch(error => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
