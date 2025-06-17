import {Tool} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import fs from 'fs/promises';
import {ModelEnum, AI_PROVIDERS} from 'llm-info';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {validatePath, applyFileEdits} from './utils/fileUtils.js';
import {InputMessage, sendPrompt} from 'send-prompt';

export type SUPPORTED_FIRST_PARTYPROVIDERS =
  | typeof AI_PROVIDERS.OPENAI
  | typeof AI_PROVIDERS.ANTHROPIC
  | typeof AI_PROVIDERS.GOOGLE;

export type SUPPORTED_THIRD_PARTY_PROVIDERS = typeof AI_PROVIDERS.OPENROUTER;

export const SUPPORTED_FIRST_PARTY_MODELS: (Omit<FirstPartyConfig, 'apiKey'> & {
  recommended: boolean;
  supportMultipleEditsPerMessage: boolean;
})[] = [
  {
    model: ModelEnum['gpt-4.1'],
    provider: AI_PROVIDERS.OPENAI,
    recommended: true,
    supportMultipleEditsPerMessage: true,
  },
  {
    model: ModelEnum['gemini-2.5-pro-preview-06-05'],
    provider: AI_PROVIDERS.GOOGLE,
    recommended: false,
    supportMultipleEditsPerMessage: true,
  },
  // {
  //   model: ModelEnum['gemini-2.5-pro-exp-03-25'],
  //   provider: AI_PROVIDERS.GOOGLE,
  //   recommended: false,
  //   supportMultipleEditsPerMessage: true,
  // },
  // {
  //   model: ModelEnum['claude-3-7-sonnet-20250219'],
  //   provider: AI_PROVIDERS.ANTHROPIC,
  //   recommended: false,
  //   supportMultipleEditsPerMessage: false,
  // },
] as const;

export const SUPPORTED_THIRD_PARTY_MODELS: (Omit<ThirdPartyConfig, 'apiKey'> & {
  recommended: boolean;
  supportMultipleEditsPerMessage: boolean;
})[] = [
  {
    customModel: 'openai/gpt-4.1',
    provider: AI_PROVIDERS.OPENROUTER,
    recommended: true,
    supportMultipleEditsPerMessage: true,
  },
  {
    customModel: 'google/gemini-2.5-pro-preview',
    provider: AI_PROVIDERS.OPENROUTER,
    recommended: false,
    supportMultipleEditsPerMessage: true,
  },
];

export const SUPPORTED_MODELS = [
  ...SUPPORTED_FIRST_PARTY_MODELS,
  ...SUPPORTED_THIRD_PARTY_MODELS,
] as const;

export type ToolCallStatus = 'success' | 'failure' | 'retry_limit_reached' | 'no_tool_calls';

const defaultSystemPrompt = `You are a helpful assistant that can edit files.

You can edit files or create new files using the edit_file tool.

You can edit multiple files at once by calling the edit_file tool multiple times.
`;

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

export type FirstPartyConfig = {
  provider: SUPPORTED_FIRST_PARTYPROVIDERS;
  model: ModelEnum;
  apiKey: string;
} & {
  headers?: Record<string, string>;
};

export type ThirdPartyConfig = {
  provider: SUPPORTED_THIRD_PARTY_PROVIDERS;
  customModel: string;
  apiKey: string;
} & {
  headers?: Record<string, string>;
};

export type ModelProviderConfig = FirstPartyConfig | ThirdPartyConfig;

export class FileEditTool {
  private anthropic: {apiKey: string} | null = null;
  private openai: {apiKey: string} | null = null;
  private google: {apiKey: string} | null = null;
  private openrouter: {apiKey: string} | null = null;
  private allowedDirectories: string[] = [];
  private fileContents: Record<string, string> = {};
  private tools: Tool[] = [];
  private modelProviderConfig: ModelProviderConfig;
  private fileContext: string[] = [];
  private maxToolUseRounds: number;
  private parentDir: string;

  constructor(
    parentDir: string,
    allowedDirectories: string[] = [],
    modelProviderConfig: ModelProviderConfig,
    fileContext: string[] = [],
    maxToolUseRounds: number = 5,
  ) {
    this.parentDir = parentDir;
    this.allowedDirectories = allowedDirectories;
    this.modelProviderConfig = modelProviderConfig;
    this.fileContext = fileContext;
    this.maxToolUseRounds = maxToolUseRounds;

    if (this.modelProviderConfig.provider === AI_PROVIDERS.ANTHROPIC) {
      this.anthropic = {apiKey: this.modelProviderConfig.apiKey};
    } else if (this.modelProviderConfig.provider === AI_PROVIDERS.OPENAI) {
      this.openai = {apiKey: this.modelProviderConfig.apiKey};
    } else if (this.modelProviderConfig.provider === AI_PROVIDERS.GOOGLE) {
      this.google = {apiKey: this.modelProviderConfig.apiKey};
    } else if (this.modelProviderConfig.provider === AI_PROVIDERS.OPENROUTER) {
      this.openrouter = {apiKey: this.modelProviderConfig.apiKey};
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
    globalMessageHistory: InputMessage[],
    toolCallId: string,
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

    if (this.modelProviderConfig.provider === AI_PROVIDERS.GOOGLE) {
      // For Google, add both the function call and response messages
      const toolCallMessage = {
        role: 'google_function_call' as const,
        id: toolCallId,
        name: toolName,
        args: toolArgs || {},
      };
      globalMessageHistory.push(toolCallMessage);
      if (newFileCreated) {
        const toolResponseMessage = {
          role: 'google_function_response' as const,
          id: toolCallId,
          name: toolName,
          response: {result: `${result}\n\n${followupTemplateNewFile}`},
        };
        globalMessageHistory.push(toolResponseMessage);
        finalText.push(toolResponseMessage.response.result);
      } else {
        const toolResponseMessage = {
          role: 'google_function_response' as const,
          id: toolCallId,
          name: toolName,
          response: {result: `${result}\n\n${followupTemplateEdit}`},
        };
        globalMessageHistory.push(toolResponseMessage);
        finalText.push(toolResponseMessage.response.result);
      }
    } else {
      // TODO: optimize other providers to also include both tool call and response messages
      if (newFileCreated) {
        const toolResultMessage = {
          role: 'user' as const,
          content:
            `[Tool call completed: New file has been created]\n\n${result}\n\n${followupTemplateNewFile}`.trimEnd(),
        };
        globalMessageHistory.push(toolResultMessage);
        finalText.push(toolResultMessage.content);
      } else {
        const assistantMessage = {
          role: 'user' as const,
          content:
            `[Tool call completed: ${result}]\n\n[Updated file content]\n\n${queryWithFileContents}\n\n${followupTemplateEdit}`.trimEnd(),
        };
        globalMessageHistory.push(assistantMessage);
        finalText.push(assistantMessage.content);
      }
    }
    return {finalText, toolResults, finalStatus, rawDiff, reverseDiff, newFileCreated};
  }

  async processQuery(
    query: string,
    debug: boolean = false,
    systemPrompt: string = defaultSystemPrompt,
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

    const globalMessageHistory: Array<InputMessage> = [
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
        console.log(JSON.stringify(globalMessageHistory, null, 2));
      }

      const apiKey =
        this.modelProviderConfig.provider === AI_PROVIDERS.ANTHROPIC
          ? this.anthropic?.apiKey
          : this.modelProviderConfig.provider === AI_PROVIDERS.OPENAI
          ? this.openai?.apiKey
          : this.modelProviderConfig.provider === AI_PROVIDERS.GOOGLE
          ? this.google?.apiKey
          : this.openrouter?.apiKey;

      if (!apiKey) {
        throw new Error('API key is not set');
      }

      const response = await sendPrompt(
        {
          messages: globalMessageHistory,
          systemPrompt,
          tools: this.tools.map(tool => {
            const schema = tool.input_schema as {
              type: string;
              properties: Record<string, any>;
              required?: string[];
            };
            const parameters: any = {
              type: 'object',
              properties: schema.properties,
              required: schema.required || [],
            };
            // Only include additionalProperties for non-Google providers
            if (this.modelProviderConfig.provider === AI_PROVIDERS.GOOGLE) {
              delete parameters.additionalProperties;
              // Also remove additionalProperties from nested items schema
              if (parameters.properties.edits?.items) {
                delete parameters.properties.edits.items.additionalProperties;
              }
            }
            return {
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description || '',
                parameters,
              },
            };
          }),
        },
        this.modelProviderConfig,
      );

      if (response.message.content) {
        finalResponseMessages.push(response.message.content);
        globalMessageHistory.push({
          role: 'assistant',
          content: response.message.content.trimEnd(),
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
            globalMessageHistory,
            toolCall.id || '',
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

export {
  applyReversePatch,
  getPlatformLineEnding,
  detectLineEnding,
  normalizeLineEndings,
  applyPlatformLineEndings,
} from './utils/fileUtils.js';
