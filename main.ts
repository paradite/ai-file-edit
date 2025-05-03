import {MCPClient} from './index.js';

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node main.ts <path_to_server_script> [--openai] [args]');
    return;
  }

  const mcpClient = new MCPClient();
  try {
    // Check if --openai flag is present
    const openaiIndex = process.argv.indexOf('--openai');
    const useOpenAI = openaiIndex !== -1;

    // Remove --openai from args if present
    const args = process.argv.slice(2).filter(arg => arg !== '--openai');

    if (args.length < 1) {
      console.log('Usage: node main.ts <path_to_server_script> [--openai] [args]');
      return;
    }

    const serverScriptPath = args[0];
    const allowedDirectories = args.slice(1);

    await mcpClient.connectToServer(serverScriptPath, allowedDirectories);
    await mcpClient.chatLoop(useOpenAI);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
