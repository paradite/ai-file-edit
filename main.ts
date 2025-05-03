import {MCPClient} from './index.js';

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: node main.ts <path_to_server_script> [args]');
    return;
  }
  const mcpClient = new MCPClient();
  try {
    const allowedDirectories = process.argv.slice(3);
    await mcpClient.connectToServer(process.argv[2], allowedDirectories);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
