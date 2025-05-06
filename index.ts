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
    toolName: string,
    toolArgs: {[x: string]: unknown} | undefined,
    messages: MessageParam[],
    round: number = 0,
  ): Promise<{
    finalText: string[];
    toolResults: string[];
    finalStatus: ToolCallStatus;
    rawDiff?: Record<string, string>;
    reverseDiff?: Record<string, string>;
  }> {
    const {
      finalText,
      toolResults,
      finalStatus: initialStatus,
      rawDiff: initialRawDiff,
      reverseDiff: initialReverseDiff,
    } = await this.handleToolUse(toolName, toolArgs, messages);

    if (initialStatus !== 'success') {
      return {
        finalText,
        toolResults,
        finalStatus: initialStatus,
        rawDiff: initialRawDiff,
        reverseDiff: initialReverseDiff,
      };
    }

    let finalStatus: ToolCallStatus = initialStatus;
    let rawDiff = initialRawDiff;
    let reverseDiff = initialReverseDiff;

    const response = await this.anthropic?.messages.create({
      model: modelName,
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    // Handle the response content
    for (const content of response?.content || []) {
      if (content.type === 'text') {
        finalText.push(content.text);
      } else if (content.type === 'tool_use') {
        if (round < this.maxToolUseRounds) {
          // If we get a tool use response and we haven't reached the round limit
          const {
            finalText: nextRoundFinalText,
            toolResults: nextRoundToolResults,
            finalStatus: nextRoundFinalStatus,
            rawDiff: nextRoundRawDiff,
            reverseDiff: nextRoundReverseDiff,
          } = await this.handleToolResponseAnthropic(
            modelName,
            content.name,
            content.input as {[x: string]: unknown} | undefined,
            messages,
            round + 1,
          );
          finalText.push(...nextRoundFinalText);
          toolResults.push(...nextRoundToolResults);
          finalStatus = nextRoundFinalStatus;
          if (nextRoundRawDiff) {
            rawDiff = {...rawDiff, ...nextRoundRawDiff};
          }
          if (nextRoundReverseDiff) {
            reverseDiff = {...reverseDiff, ...nextRoundReverseDiff};
          }
        } else {
          // If we get a tool use response but we've reached the round limit
          finalText.push(
            `[Maximum tool use rounds (${this.maxToolUseRounds}) reached. Stopping further tool calls.]`,
          );
          finalStatus = 'retry_limit_reached';
        }
      }
    }

    return {finalText, toolResults, finalStatus, rawDiff, reverseDiff};
  }

  private async handleToolResponseOpenAI(
    modelName: ModelEnum,
    messages: MessageParam[],
  ): Promise<ChatCompletionMessage> {
    const openAIMessages = messages.map(this.convertAnthropicMessageToOpenAI.bind(this));

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

  async processQuery(query: string): Promise<{
    finalText: string[];
    toolResults: string[];
    finalStatus: ToolCallStatus;
    toolCallCount: number;
    rawDiff?: Record<string, string>;
    reverseDiff?: Record<string, string>;
  }> {
    let toolCallCount = 0;
    let finalStatus: ToolCallStatus = 'success';
    let rawDiff: Record<string, string> | undefined;
    let reverseDiff: Record<string, string> | undefined;

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

    let round = 1;

    if (this.provider === AI_PROVIDERS.OPENAI) {
      const openAIMessages = globalMessages.map(this.convertAnthropicMessageToOpenAI.bind(this));

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

      if (initMessage?.tool_calls) {
        for (const toolCall of initMessage.tool_calls) {
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

      let newMessage = await this.handleToolResponseOpenAI(this.modelName, globalMessages);
      while (newMessage.tool_calls && round < this.maxToolUseRounds) {
        for (const toolCall of newMessage.tool_calls) {
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

        newMessage = await this.handleToolResponseOpenAI(this.modelName, globalMessages);
        round++;
      }

      return {finalText, toolResults, finalStatus, toolCallCount, rawDiff, reverseDiff};
    } else if (this.provider === AI_PROVIDERS.ANTHROPIC) {
      const response = await this.anthropic?.messages.create({
        model: this.modelName,
        max_tokens: 1000,
        messages: globalMessages,
        tools: this.tools,
      });

      const finalText = [];
      const toolResults = [];

      for (const content of response?.content || []) {
        if (content.type === 'text') {
          finalText.push(content.text);
        } else if (content.type === 'tool_use') {
          const {
            finalText: toolFinalText,
            toolResults: newToolResults,
            finalStatus: toolFinalStatus,
            rawDiff: newRawDiff,
            reverseDiff: newReverseDiff,
          } = await this.handleToolResponseAnthropic(
            this.modelName,
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

      if (toolCallCount === 0) {
        finalStatus = 'no_tool_calls';
      }

      return {finalText, toolResults, finalStatus, toolCallCount, rawDiff, reverseDiff};
    } else {
      return {
        finalText: [`[Unsupported model: ${this.modelName}]`],
        toolResults: [],
        finalStatus: 'failure',
        toolCallCount: 0,
      };
    }
  }
}

export {applyReversePatch};
