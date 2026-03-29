import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/cli.ts', 'mcp'],
    cwd: process.cwd(),
  });

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);

  const result = await client.listTools();

  console.log(`\nMCP Tools registered: ${result.tools.length}\n`);
  for (const tool of result.tools) {
    console.log(`  - ${tool.name}`);
    console.log(`    ${tool.description}`);
    const props = Object.keys((tool.inputSchema as any)?.properties ?? {});
    if (props.length > 0) {
      console.log(`    params: ${JSON.stringify(props)}`);
    }
    console.log();
  }

  await client.close();
}

main();
