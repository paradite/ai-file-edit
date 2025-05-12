import {MessageParam, Tool} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import fs from 'fs/promises';
import {ModelEnum, AI_PROVIDERS, AI_PROVIDER_TYPE} from 'llm-info';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {validatePath, applyFileEdits, applyReversePatch} from './utils/fileUtils.js';
import {InputMessage, sendPrompt} from 'send-prompt';

export type ToolCallStatus = 'success' | 'failure' | 'retry_limit_reached' | 'no_tool_calls';

const followupTemplateNewFile = `Based on the tool call result, check if you need to perform any follow up actions via the tools.

If you need to perform follow up actions, call the appropriate tool. If not, respond with "No follow up actions needed".
`;

const followupTemplateEdit = `Based on the tool call result and the updated file contents, check if you need to perform any follow up actions via the tools.

If you need to perform follow up actions, call the appropriate tool. If not, respond with "No follow up actions needed".
`;

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
});

export class FileEditTool {
  private anthropic: {apiKey: string} | null = null;
  private openai: {apiKey: string} | null = null;
  private allowedDirectories: string[] = [];
  private fileContents: Record<string, string> = {};
  private tools: Tool[] = [];
  private modelName: ModelEnum;
  private provider: AI_PROVIDER_TYPE;
  private fileContext: string[] = [];
  private maxToolUseRounds: number;
  private parentDir: string;

  constructor(
    parentDir: string,
    allowedDirectories: string[] = [],
    modelName: ModelEnum,
    provider: AI_PROVIDER_TYPE,
    apiKey: string,
    fileContext: string[] = [],
    maxToolUseRounds: number = 5,
  ) {
    this.parentDir = parentDir;
    this.allowedDirectories = allowedDirectories;
    this.modelName = modelName;
    this.provider = provider;
    this.fileContext = fileContext;
    this.maxToolUseRounds = maxToolUseRounds;

    if (provider === AI_PROVIDERS.ANTHROPIC) {
      this.anthropic = {apiKey};
    } else if (provider === AI_PROVIDERS.OPENAI) {
      this.openai = {apiKey};
    }

    const editFileSchema = zodToJsonSchema(EditFileArgsSchema) as {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
    this.tools = [
      {
        name: 'edit_file',
        description:
          'Create a new file, overwrite an existing file, or make selective edits to a file. ' +
          'For new files or complete overwrites, use the content parameter. ' +
          'For partial edits, use the edits parameter to specify text replacements. ' +
          'Note: content and edits parameters are mutually exclusive - use one or the other, not both. ' +
          'Returns a git-style diff showing the changes made. ' +
          'Only works within allowed directories.',
        input_schema: {
          type: 'object' as const,
          properties: editFileSchema.properties,
          required: editFileSchema.required,
        },
      },
    ];
  }

  private async refreshFileContents() {
    // read only the files specified in fileContext
    for (const filePath of this.fileContext) {
      try {
        this.fileContents[filePath] = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
      }
    }
  }

  private async handleToolUse(
    toolName: string,
    toolArgs: {[x: string]: unknown} | undefined,
    toolCallMessages: InputMessage[],
    userTextMessages: InputMessage[],
  ): Promise<{
    finalText: string[];
    toolResults: string[];
    finalStatus: ToolCallStatus;
    rawDiff?: Record<string, string>;
    reverseDiff?: Record<string, string>;
    newFileCreated: boolean;
  }> {
    const finalText: string[] = [];
    const toolResults: string[] = [];
    let finalStatus: ToolCallStatus = 'success';
    let rawDiff: Record<string, string> | undefined;
    let reverseDiff: Record<string, string> | undefined;
    let newFileCreated: boolean = false;

    finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);

    let result: string;
    if (toolName === 'edit_file') {
      const parsed = EditFileArgsSchema.safeParse(toolArgs);
      if (!parsed.success) {
        return {
          finalText: [`[Invalid arguments for edit_file: ${parsed.error}]`],
          toolResults: [],
          finalStatus: 'failure',
          newFileCreated: false,
        };
      }
      if (parsed.data.content === undefined && parsed.data.edits === undefined) {
        return {
          finalText: [`[Either content or edits must be provided]`],
          toolResults: [],
          finalStatus: 'failure',
          newFileCreated: false,
        };
      }
      if (parsed.data.content !== undefined && parsed.data.edits !== undefined) {
        return {
          finalText: [
            `[Cannot provide both content and edits - use content for complete file writes and edits for partial changes]`,
          ],
          toolResults: [],
          finalStatus: 'failure',
          newFileCreated: false,
        };
      }
      try {
        const validPath = await validatePath(
          this.parentDir,
          parsed.data.path,
          this.allowedDirectories,
        );
        const {
          response,
          rawDiff: newRawDiff,
          newFileCreated: resultNewFileCreated,
          validEdits,
          reverseDiff: newReverseDiff,
        } = await applyFileEdits(this.parentDir, validPath, parsed.data.edits, parsed.data.content);
        result = response;
        if (validEdits) {
          rawDiff = {[validPath]: newRawDiff};
          reverseDiff = {[validPath]: newReverseDiff};
        }
        newFileCreated = resultNewFileCreated;
      } catch (error) {
        return {
          finalText: [`[Error applying edits: ${error}]`],
          toolResults: [],
          finalStatus: 'failure',
          newFileCreated: false,
        };
      }
    } else {
      return {
        finalText: [`[Unknown tool: ${toolName}]`],
        toolResults: [],
        finalStatus: 'failure',
        newFileCreated: false,
      };
    }

    toolResults.push(result);
    finalText.push(`[Tool ${toolName} returned: ${result}]`);

    // Update file contents after tool call
    await this.refreshFileContents();

    // Update the messages with latest file contents
    const queryWithFileContents = this.fileContents
      ? Object.entries(this.fileContents)
          .map(([file, content]) => `File \`${file}\`:\n\`\`\`\n${content}\`\`\``)
          .join('\n\n')
      : '';

    if (newFileCreated) {
      const toolResultMessage = {
        role: 'assistant' as const,
        content: `[Tool call completed: New file has been created]\n\n${result}`,
      };
      toolCallMessages.push(toolResultMessage);
      userTextMessages.push({
        role: 'user' as const,
        content: toolResultMessage.content,
      });
      finalText.push(toolResultMessage.content);

      const followup = {
        role: 'user' as const,
        content: followupTemplateNewFile,
      };
      toolCallMessages.push(followup);
      finalText.push(followup.content);

      return {finalText, toolResults, finalStatus, rawDiff, reverseDiff, newFileCreated};
    } else {
      const assistantMessage = {
        role: 'assistant' as const,
        content: `[Tool call completed: ${result}]\n\n[New file content]\n\n${queryWithFileContents}`,
      };
      toolCallMessages.push(assistantMessage);
      userTextMessages.push({
        role: 'user' as const,
        content: assistantMessage.content,
      });
      finalText.push(assistantMessage.content);
      const followup = {
        role: 'user' as const,
        content: followupTemplateEdit,
      };
      toolCallMessages.push(followup);
      finalText.push(followup.content);
      return {finalText, toolResults, finalStatus, rawDiff, reverseDiff, newFileCreated};
    }
  }

  async processQuery(
    query: string,
    debug: boolean = false,
  ): Promise<{
    finalText: string[];
    toolResults: string[];
    finalStatus: ToolCallStatus;
    toolCallCount: number;
    toolCallRounds: number;
    rawDiff?: Record<string, string>;
    reverseDiff?: Record<string, string>;
  }> {
    let toolCallCount = 0;
    let finalStatus: ToolCallStatus = 'success';
    let rawDiff: Record<string, string> | undefined;
    let reverseDiff: Record<string, string> | undefined;

    if (debug) {
      console.log('Processing query:', query);
    }

    await this.refreshFileContents();

    // prepend the file contents to the query
    const queryWithFileContents = this.fileContents
      ? Object.entries(this.fileContents)
          .map(([file, content]) => `File \`${file}\`:\n\`\`\`\n${content}\`\`\``)
          .join('\n\n')
      : '';

    const messageContent = queryWithFileContents + '\n\n' + query;

    // Messages for send-prompt
    const messagesForUser: Array<InputMessage> = [
      {
        role: 'user',
        content: messageContent,
      },
    ];

    // Messages for handleToolUse
    const messagesForToolCall: Array<InputMessage> = [
      {
        role: 'user',
        content: messageContent,
      },
    ];

    let toolCallRounds = 0;
    const finalResponseMessages: string[] = [];
    const toolResults: string[] = [];

    while (toolCallRounds < this.maxToolUseRounds) {
      if (debug) {
        console.log(`Starting tool call round ${toolCallRounds + 1}`);
      }

      const apiKey =
        this.provider === AI_PROVIDERS.ANTHROPIC ? this.anthropic?.apiKey : this.openai?.apiKey;

      if (!apiKey) {
        throw new Error('API key is not set');
      }

      const response = await sendPrompt({
        messages: messagesForUser,
        model: this.modelName,
        provider: this.provider,
        apiKey,
        tools: this.tools.map(tool => {
          const schema = tool.input_schema as {
            type: string;
            properties: Record<string, any>;
            required?: string[];
          };
          return {
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description || '',
              parameters: {
                type: 'object',
                properties: schema.properties,
                required: schema.required || [],
                additionalProperties: false,
              },
            },
          };
        }),
      });

      if (response.message.content) {
        finalResponseMessages.push(response.message.content);
        messagesForUser.push({
          role: 'assistant',
          content: response.message.content,
        });
        messagesForToolCall.push({
          role: 'assistant',
          content: response.message.content,
        });
      }

      if (debug) {
        console.log('Received response:', response);
      }

      let hasToolCalls = false;
      if (response.tool_calls) {
        hasToolCalls = true;
        toolCallRounds++;
        for (const toolCall of response.tool_calls) {
          if (debug) {
            console.log('Processing tool call:', toolCall);
          }

          const {
            finalText: toolFinalText,
            toolResults: newToolResults,
            finalStatus: toolFinalStatus,
            rawDiff: newRawDiff,
            reverseDiff: newReverseDiff,
          } = await this.handleToolUse(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments),
            messagesForToolCall,
            messagesForUser,
          );

          finalResponseMessages.push(...toolFinalText);
          toolResults.push(...newToolResults);
          finalStatus = toolFinalStatus;
          toolCallCount++;

          if (newRawDiff) {
            rawDiff = {...rawDiff, ...newRawDiff};
          }
          if (newReverseDiff) {
            reverseDiff = {...reverseDiff, ...newReverseDiff};
          }
        }
      }

      if (!hasToolCalls) {
        if (toolCallCount === 0) {
          finalStatus = 'no_tool_calls';
        }
        break;
      }
    }

    if (toolCallRounds >= this.maxToolUseRounds) {
      finalStatus = 'retry_limit_reached';
    }

    return {
      finalText: finalResponseMessages,
      toolResults,
      finalStatus,
      toolCallCount,
      toolCallRounds,
      rawDiff,
      reverseDiff,
    };
  }
}

export {applyReversePatch};
