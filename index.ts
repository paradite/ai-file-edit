import {Anthropic} from '@anthropic-ai/sdk';
import {MessageParam, Tool} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import readline from 'readline/promises';
import fs from 'fs/promises';
import path from 'path';
import {OpenAI} from 'openai';
import {ChatCompletionMessageParam} from 'openai/resources/chat/completions';
import {ModelEnum} from 'llm-info';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {validatePath, applyFileEdits} from './utils/fileUtils.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Use model enums from llm-info package
const ANTHROPIC_MODEL = ModelEnum['claude-3-5-sonnet-20241022'];
const OPENAI_MODEL = ModelEnum['gpt-4o'];

if (!ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is not set');
}

if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

const followupTemplate = (toolResults: string) => `Tool call returned the following result:

${toolResults}

Check if you need to perform any follow up actions via the tools.

If so, call the appropriate tool. If not, just return "No follow up actions needed".
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
  dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format'),
});

const ToolInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.any(),
});

export class MCPClient {
  private anthropic: Anthropic;
  private openai: OpenAI;
  private allowedDirectories: string[] = [];
  private fileContents: Record<string, string> = {};
  private tools: Tool[] = [];

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
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

  async connectToServer(allowedDirectories: string[] = []) {
    this.allowedDirectories = allowedDirectories;

    // read all files in allowedDirectories
    for (const dir of allowedDirectories) {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        this.fileContents[filePath] = await fs.readFile(filePath, 'utf8');
      }
    }

    console.log(
      'Connected with tools:',
      this.tools.map(({name}) => name),
    );
  }

  private async handleAnthropicToolUse(
    toolName: string,
    toolArgs: {[x: string]: unknown} | undefined,
    messages: MessageParam[],
    round: number = 1,
  ): Promise<{finalText: string[]; toolResults: string[]}> {
    const finalText = [];
    const toolResults = [];

    finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);

    let result: string;
    if (toolName === 'edit_file') {
      const parsed = EditFileArgsSchema.safeParse(toolArgs);
      if (!parsed.success) {
        return {
          finalText: [`[Invalid arguments for edit_file: ${parsed.error}]`],
          toolResults: [],
        };
      }
      if (parsed.data.content === undefined && parsed.data.edits === undefined) {
        return {
          finalText: [`[Either content or edits must be provided]`],
          toolResults: [],
        };
      }
      if (parsed.data.content !== undefined && parsed.data.edits !== undefined) {
        return {
          finalText: [
            `[Cannot provide both content and edits - use content for complete file writes and edits for partial changes]`,
          ],
          toolResults: [],
        };
      }
      try {
        const validPath = await validatePath(parsed.data.path, this.allowedDirectories);
        result = await applyFileEdits(
          validPath,
          parsed.data.edits,
          parsed.data.content,
          parsed.data.dryRun,
        );
      } catch (error) {
        return {
          finalText: [`[Error applying edits: ${error}]`],
          toolResults: [],
        };
      }
    } else {
      return {
        finalText: [`[Unknown tool: ${toolName}]`],
        toolResults: [],
      };
    }

    toolResults.push(result);
    finalText.push(`[Tool ${toolName} returned: ${result}]`);

    const followup = {
      role: 'user',
      content: followupTemplate(result),
    } as MessageParam;

    messages.push(followup);

    finalText.push(`[Follow up: ${followup.content}]`);

    const response = await this.anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    // Handle the response content
    for (const content of response.content) {
      if (content.type === 'text') {
        finalText.push(content.text);
      } else if (content.type === 'tool_use') {
        if (round < 2) {
          // If we get a tool use response and we haven't reached the round limit
          const {finalText: nextRoundFinalText, toolResults: nextRoundToolResults} =
            await this.handleAnthropicToolUse(
              content.name,
              content.input as {[x: string]: unknown} | undefined,
              messages,
              round + 1,
            );
          finalText.push(...nextRoundFinalText);
          toolResults.push(...nextRoundToolResults);
        } else {
          // If we get a tool use response but we've reached the round limit
          finalText.push('[Maximum tool use rounds (2) reached. Stopping further tool calls.]');
        }
      }
    }

    return {finalText, toolResults};
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

  private async handleOpenAIToolUse(
    toolName: string,
    toolArgs: {[x: string]: unknown} | undefined,
    messages: MessageParam[],
    round: number = 1,
  ): Promise<{finalText: string[]; toolResults: string[]}> {
    const finalText = [];
    const toolResults = [];

    finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);

    let result: string;
    if (toolName === 'edit_file') {
      const parsed = EditFileArgsSchema.safeParse(toolArgs);
      if (!parsed.success) {
        return {
          finalText: [`[Invalid arguments for edit_file: ${parsed.error}]`],
          toolResults: [],
        };
      }
      if (parsed.data.content === undefined && parsed.data.edits === undefined) {
        return {
          finalText: [`[Either content or edits must be provided]`],
          toolResults: [],
        };
      }
      if (parsed.data.content !== undefined && parsed.data.edits !== undefined) {
        return {
          finalText: [
            `[Cannot provide both content and edits - use content for complete file writes and edits for partial changes]`,
          ],
          toolResults: [],
        };
      }
      try {
        const validPath = await validatePath(parsed.data.path, this.allowedDirectories);
        result = await applyFileEdits(
          validPath,
          parsed.data.edits,
          parsed.data.content,
          parsed.data.dryRun,
        );
      } catch (error) {
        return {
          finalText: [`[Error applying edits: ${error}]`],
          toolResults: [],
        };
      }
    } else {
      return {
        finalText: [`[Unknown tool: ${toolName}]`],
        toolResults: [],
      };
    }

    toolResults.push(result);
    finalText.push(`[Tool ${toolName} returned: ${result}]`);

    const followup = {
      role: 'user',
      content: followupTemplate(result),
    } as MessageParam;

    messages.push(followup);

    finalText.push(`[Follow up: ${followup.content}]`);

    const openAIMessages = messages.map(this.convertAnthropicMessageToOpenAI.bind(this));

    const response = await this.openai.chat.completions.create({
      model: OPENAI_MODEL,
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
    if (message.content) {
      finalText.push(message.content);
    }

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (round < 2) {
          // If we get a tool use response and we haven't reached the round limit
          const {finalText: nextRoundFinalText, toolResults: nextRoundToolResults} =
            await this.handleOpenAIToolUse(
              toolCall.function.name,
              JSON.parse(toolCall.function.arguments),
              messages,
              round + 1,
            );
          finalText.push(...nextRoundFinalText);
          toolResults.push(...nextRoundToolResults);
        } else {
          // If we get a tool use response but we've reached the round limit
          finalText.push('[Maximum tool use rounds (2) reached. Stopping further tool calls.]');
        }
      }
    }

    return {finalText, toolResults};
  }

  async processQuery(
    query: string,
    useOpenAI: boolean = false,
  ): Promise<{finalText: string[]; toolResults: unknown[]}> {
    // prepend the file contents to the query
    const queryWithFileContents = Object.entries(this.fileContents)
      .map(([file, content]) => `[File ${file}]:\n${content}`)
      .join('\n');

    const messageContent = queryWithFileContents + '\n' + query;

    const messages: MessageParam[] = [
      {
        role: 'user',
        content: messageContent,
      },
    ];

    if (useOpenAI) {
      const openAIMessages = messages.map(this.convertAnthropicMessageToOpenAI.bind(this));

      const response = await this.openai.chat.completions.create({
        model: OPENAI_MODEL,
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

      const finalText = [];
      const toolResults = [];

      const message = response.choices[0].message;
      if (message.content) {
        finalText.push(message.content);
      }

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          const {finalText: toolFinalText, toolResults: newToolResults} =
            await this.handleOpenAIToolUse(
              toolCall.function.name,
              JSON.parse(toolCall.function.arguments),
              messages,
            );
          finalText.push(...toolFinalText);
          toolResults.push(...newToolResults);
        }
      }

      return {finalText, toolResults};
    } else {
      const response = await this.anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        messages,
        tools: this.tools,
      });

      const finalText = [];
      const toolResults = [];

      for (const content of response.content) {
        if (content.type === 'text') {
          finalText.push(content.text);
        } else if (content.type === 'tool_use') {
          const {finalText: toolFinalText, toolResults: newToolResults} =
            await this.handleAnthropicToolUse(
              content.name,
              content.input as {[x: string]: unknown} | undefined,
              messages,
            );
          finalText.push(...toolFinalText);
          toolResults.push(...newToolResults);
        }
      }

      return {finalText, toolResults};
    }
  }

  async chatLoop(useOpenAI: boolean = false) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\nMCP Client Started!');
      console.log(`Using ${useOpenAI ? 'OpenAI' : 'Anthropic'} for processing queries`);
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question('\nQuery: ');
        if (message.toLowerCase() === 'quit') {
          break;
        }
        const response = await this.processQuery(message, useOpenAI);
        console.log('\nResponse:\n' + response.finalText.join('\n'));
        console.log('\nTool results:\n' + JSON.stringify(response.toolResults, null, 2));
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    // No need to close any connections as the tools are now handled locally
  }
}
