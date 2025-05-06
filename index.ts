import {Anthropic} from '@anthropic-ai/sdk';
import {MessageParam, Tool} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import fs from 'fs/promises';
import {OpenAI} from 'openai';
import {ChatCompletionMessage, ChatCompletionMessageParam} from 'openai/resources/chat/completions';
import {ModelEnum, AI_PROVIDERS, AI_PROVIDER_TYPE} from 'llm-info';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {validatePath, applyFileEdits, applyReversePatch} from './utils/fileUtils.js';

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
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;
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
    maxToolUseRounds: number = 3,
  ) {
    this.parentDir = parentDir;
    this.allowedDirectories = allowedDirectories;
    this.modelName = modelName;
    this.provider = provider;
    this.fileContext = fileContext;
    this.maxToolUseRounds = maxToolUseRounds;

    if (provider === AI_PROVIDERS.ANTHROPIC) {
      this.anthropic = new Anthropic({
        apiKey,
        dangerouslyAllowBrowser: true,
      });
    } else if (provider === AI_PROVIDERS.OPENAI) {
      this.openai = new OpenAI({
        apiKey,
        dangerouslyAllowBrowser: true,
      });
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
    messages: MessageParam[],
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
      const assistantMessage = {
        role: 'assistant' as const,
        content: `[Tool call completed: New file has been created]\n\n${result}`,
      };
      messages.push(assistantMessage);
      finalText.push(assistantMessage.content);

      const followup = {
        role: 'user' as const,
        content: followupTemplateNewFile,
      };
      messages.push(followup);
      finalText.push(followup.content);
      return {finalText, toolResults, finalStatus, rawDiff, reverseDiff, newFileCreated};
    } else {
      const assistantMessage = {
        role: 'assistant' as const,
        content: `[Tool call completed: ${result}]\n\n[New file content]\n\n${queryWithFileContents}`,
      };
      messages.push(assistantMessage);
      finalText.push(assistantMessage.content);
      const followup = {
        role: 'user' as const,
        content: followupTemplateEdit,
      };
      messages.push(followup);
      finalText.push(followup.content);
      return {finalText, toolResults, finalStatus, rawDiff, reverseDiff, newFileCreated};
    }
  }

  private async handleToolResponseAnthropic(
    modelName: ModelEnum,
    messages: MessageParam[],
    debug: boolean,
  ): Promise<MessageParam> {
    if (debug) {
      console.log('Sending Anthropic followup message');
      console.log(JSON.stringify(messages, null, 2));
    }
    const response = await this.anthropic?.beta.messages.create({
      model: modelName,
      max_tokens: 8192,
      messages,
      tools: this.tools,
      betas: ['token-efficient-tools-2025-02-19'],
    });

    if (debug) {
      console.log('Received Anthropic followup response');
      console.log(JSON.stringify(response, null, 2));
    }

    return {
      role: 'assistant',
      content: response?.content || [],
    };
  }

  private async handleToolResponseOpenAI(
    modelName: ModelEnum,
    messages: MessageParam[],
    debug: boolean,
  ): Promise<ChatCompletionMessage> {
    const openAIMessages = messages.map(this.convertAnthropicMessageToOpenAI.bind(this));

    if (debug) {
      console.log('Sending followup OpenAI messages');
    }
    const response = await this.openai!.chat.completions.create({
      model: modelName,
      messages: openAIMessages,
      tools: this.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      })),
    });
    if (debug) {
      console.log('Received followup OpenAI response');
    }

    // Handle the response content
    const message = response.choices[0].message;
    return message;
  }

  private convertAnthropicMessageToOpenAI(msg: MessageParam): ChatCompletionMessageParam {
    return {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content:
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map(c => (c.type === 'text' ? c.text : ''))
              .filter(Boolean)
              .join('\n'),
    };
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

    const globalMessages: MessageParam[] = [
      {
        role: 'user',
        content: messageContent,
      },
    ];

    let toolCallRounds = 0;

    if (this.provider === AI_PROVIDERS.OPENAI) {
      const openAIMessages = globalMessages.map(this.convertAnthropicMessageToOpenAI.bind(this));

      if (debug) {
        console.log('Sending OpenAI initial message');
      }
      const response = await this.openai?.chat.completions.create({
        model: this.modelName,
        messages: openAIMessages,
        tools: this.tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        })),
      });

      const finalText: string[] = [];
      const toolResults: string[] = [];

      const initMessage = response?.choices[0].message;
      if (initMessage?.content) {
        finalText.push(initMessage.content);
      }

      if (debug) {
        console.log('Received OpenAI initial response:', initMessage);
      }

      if (initMessage?.tool_calls) {
        toolCallRounds++;
        for (const toolCall of initMessage.tool_calls) {
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
            globalMessages,
          );

          finalText.push(...toolFinalText);
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

      if (toolCallCount === 0) {
        finalStatus = 'no_tool_calls';
      }

      let newMessage = await this.handleToolResponseOpenAI(this.modelName, globalMessages, debug);
      while (newMessage.tool_calls && toolCallRounds < this.maxToolUseRounds) {
        for (const toolCall of newMessage.tool_calls) {
          if (debug) {
            console.log('Processing tool call:', toolCall);
          }
          const {
            finalText: toolFinalText,
            toolResults: newToolResults,
            finalStatus: toolFinalStatus,
          } = await this.handleToolUse(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments),
            globalMessages,
          );

          finalText.push(...toolFinalText);
          toolResults.push(...newToolResults);
          finalStatus = toolFinalStatus;
          toolCallCount++;
        }

        newMessage = await this.handleToolResponseOpenAI(this.modelName, globalMessages, debug);
        toolCallRounds++;
      }

      if (toolCallRounds >= this.maxToolUseRounds && newMessage.tool_calls) {
        finalStatus = 'retry_limit_reached';
      }

      return {
        finalText,
        toolResults,
        finalStatus,
        toolCallCount,
        toolCallRounds,
        rawDiff,
        reverseDiff,
      };
    } else if (this.provider === AI_PROVIDERS.ANTHROPIC) {
      const finalText: string[] = [];
      const toolResults: string[] = [];

      if (debug) {
        console.log('Sending Anthropic initial message');
      }

      const message = await this.anthropic!.beta.messages.create({
        model: this.modelName,
        max_tokens: 8192,
        messages: globalMessages,
        tools: this.tools,
        betas: ['token-efficient-tools-2025-02-19'],
      });

      console.log('Received Anthropic initial response');
      console.log(JSON.stringify(message, null, 2));

      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (typeof content === 'string') {
            finalText.push(content);
          } else if (content.type === 'text') {
            finalText.push(content.text);
          }
        }
      }

      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (typeof content !== 'string' && content.type === 'tool_use') {
            if (debug) {
              console.log('Processing tool call:', content.name);
            }
            const {
              finalText: toolFinalText,
              toolResults: newToolResults,
              finalStatus: toolFinalStatus,
              rawDiff: newRawDiff,
              reverseDiff: newReverseDiff,
            } = await this.handleToolUse(
              content.name,
              content.input as {[x: string]: unknown} | undefined,
              globalMessages,
            );

            finalText.push(...toolFinalText);
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
      }

      if (toolCallCount === 0) {
        finalStatus = 'no_tool_calls';
      } else {
        toolCallRounds++;
      }

      let newMessage = await this.handleToolResponseAnthropic(
        this.modelName,
        globalMessages,
        debug,
      );
      while (
        Array.isArray(newMessage.content) &&
        newMessage.content.some(
          content => typeof content !== 'string' && content.type === 'tool_use',
        ) &&
        toolCallRounds < this.maxToolUseRounds
      ) {
        for (const content of newMessage.content) {
          if (typeof content !== 'string' && content.type === 'tool_use') {
            if (debug) {
              console.log('Processing tool call:', content.name);
            }
            const {
              finalText: toolFinalText,
              toolResults: newToolResults,
              finalStatus: toolFinalStatus,
              rawDiff: newRawDiff,
              reverseDiff: newReverseDiff,
            } = await this.handleToolUse(
              content.name,
              content.input as {[x: string]: unknown} | undefined,
              globalMessages,
            );

            finalText.push(...toolFinalText);
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

        newMessage = await this.handleToolResponseAnthropic(this.modelName, globalMessages, debug);
        toolCallRounds++;
      }

      if (
        toolCallRounds >= this.maxToolUseRounds &&
        Array.isArray(newMessage.content) &&
        newMessage.content.some(
          content => typeof content !== 'string' && content.type === 'tool_use',
        )
      ) {
        finalStatus = 'retry_limit_reached';
      }

      return {
        finalText,
        toolResults,
        finalStatus,
        toolCallCount,
        toolCallRounds,
        rawDiff,
        reverseDiff,
      };
    } else {
      return {
        finalText: [`[Unsupported model: ${this.modelName}]`],
        toolResults: [],
        finalStatus: 'failure',
        toolCallCount: 0,
        toolCallRounds: 0,
        rawDiff: undefined,
        reverseDiff: undefined,
      };
    }
  }
}

export {applyReversePatch};
