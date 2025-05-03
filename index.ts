import {Anthropic} from '@anthropic-ai/sdk';
import {MessageParam, Tool} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import readline from 'readline/promises';
import fs from 'fs/promises';
import path from 'path';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is not set');
}

const followupTemplate = (toolResults: string) => `Tool call returned the following result:

${toolResults}

Check if you need to perform any follow up actions via the tools.

If so, call the appropriate tool. If not, just return "No follow up actions needed".
`;

export class MCPClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];
  private allowedDirectories: string[] = [];
  private fileContents: Record<string, string> = {};

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcp = new Client({name: 'mcp-client-cli', version: '1.0.0'});
  }

  async connectToServer(serverScriptPath: string, allowedDirectories: string[] = []) {
    this.allowedDirectories = allowedDirectories;

    // read all files in allowedDirectories
    for (const dir of allowedDirectories) {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        this.fileContents[filePath] = await fs.readFile(filePath, 'utf8');
      }
    }

    try {
      const isJs = serverScriptPath.endsWith('.js');
      const isPy = serverScriptPath.endsWith('.py');
      if (!isJs && !isPy) {
        throw new Error('Server script must be a .js or .py file');
      }
      const command = isPy
        ? process.platform === 'win32'
          ? 'python'
          : 'python3'
        : process.execPath;

      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath, ...this.allowedDirectories],
      });
      this.mcp.connect(this.transport);

      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map(tool => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      console.log(
        'Connected to server with tools:',
        this.tools.map(({name}) => name),
      );
    } catch (e) {
      console.log('Failed to connect to MCP server: ', e);
      throw e;
    }
  }

  private async handleToolUse(
    toolName: string,
    toolArgs: {[x: string]: unknown} | undefined,
    messages: MessageParam[],
    round: number = 1,
  ): Promise<{finalText: string[]; toolResults: string[]}> {
    const finalText = [];
    const toolResults = [];

    finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);
    const result = await this.mcp.callTool({
      name: toolName,
      arguments: toolArgs,
    });
    const resultContent = result.content as {type: 'text'; text: string}[];
    toolResults.push(resultContent[0].text);
    finalText.push(`[Tool ${toolName} returned: ${JSON.stringify(result)}]`);

    const followup = {
      role: 'user',
      content: followupTemplate(resultContent[0].text),
    } as MessageParam;

    messages.push(followup);

    finalText.push(`[Follow up: ${followup.content}]`);

    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
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
            await this.handleToolUse(
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

  async processQuery(query: string): Promise<{finalText: string[]; toolResults: unknown[]}> {
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

    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
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
        const {finalText: toolFinalText, toolResults: newToolResults} = await this.handleToolUse(
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

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\nMCP Client Started!');
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question('\nQuery: ');
        if (message.toLowerCase() === 'quit') {
          break;
        }
        const response = await this.processQuery(message);
        console.log('\nResponse:\n' + response.finalText.join('\n'));
        console.log('\nTool results:\n' + JSON.stringify(response.toolResults, null, 2));
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcp.close();
  }
}
