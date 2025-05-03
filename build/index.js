import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import readline from 'readline/promises';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
}
export class MCPClient {
    mcp;
    anthropic;
    transport = null;
    tools = [];
    allowedDirectories = [];
    constructor() {
        this.anthropic = new Anthropic({
            apiKey: ANTHROPIC_API_KEY,
        });
        this.mcp = new Client({ name: 'mcp-client-cli', version: '1.0.0' });
    }
    async connectToServer(serverScriptPath, allowedDirectories = []) {
        this.allowedDirectories = allowedDirectories;
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
            console.log('Connected to server with tools:', this.tools.map(({ name }) => name));
        }
        catch (e) {
            console.log('Failed to connect to MCP server: ', e);
            throw e;
        }
    }
    async processQuery(query) {
        const messages = [
            {
                role: 'user',
                content: query,
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
            }
            else if (content.type === 'tool_use') {
                const toolName = content.name;
                const toolArgs = content.input;
                finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);
                const result = await this.mcp.callTool({
                    name: toolName,
                    arguments: toolArgs,
                });
                toolResults.push(result);
                finalText.push(`[Tool ${toolName} returned: ${JSON.stringify(result)}]`);
                messages.push({
                    role: 'user',
                    content: result.content,
                });
                const response = await this.anthropic.messages.create({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 1000,
                    messages,
                });
                finalText.push(response.content[0].type === 'text' ? response.content[0].text : '');
            }
        }
        return finalText.join('\n');
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
                console.log('\n' + response);
            }
        }
        finally {
            rl.close();
        }
    }
    async cleanup() {
        await this.mcp.close();
    }
}
