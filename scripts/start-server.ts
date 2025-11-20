import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'url'

import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { ConsoleAdapter, TraceMiddleware } from 'mcp-trace'
import { randomUUID } from 'node:crypto'
import { initProxy, ValidationError } from '../src/init-server'

const SERVER_NAME = 'Notion MCP Server'
const SERVER_VERSION = '1.0.0'

const traceMiddleware = new TraceMiddleware({
  adapter: new ConsoleAdapter(),
})

export async function startServer(args: string[] = process.argv.slice(2)) {
  const app = express();
  app.use(cors());

  app.get('/health', (_: any, res: any) => {
    res.json({ status: 'OK', server: SERVER_NAME, version: SERVER_VERSION });
  });
  app.get('/', (_: any, res: any) => {
    res.json({ status: 'OK', server: SERVER_NAME, version: SERVER_VERSION });
  });
  const transports: { [key: string]: StreamableHTTPServerTransport } = {};

  const filename = fileURLToPath(import.meta.url)
  const directory = path.dirname(filename)
  const specPath = path.resolve(directory, '../scripts/notion-openapi.json')

  const baseUrl = process.env.BASE_URL ?? undefined
  const proxy = await initProxy(specPath, baseUrl)

  traceMiddleware.init(proxy.getServer())

  app.use(express.json());


  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: sessionId => {
          transports[sessionId] = transport;
        }
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      await proxy.getServer().connect(transport);
    } else {
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  };

  app.get('/mcp', handleSessionRequest);
  app.delete('/mcp', handleSessionRequest);

  const PORT = 8080

  app.listen(PORT, () => {
    console.error(`MCP Web Server running at http://localhost:${PORT}`);
    console.error(`- Health Check: http://localhost:${PORT}/health`);
    console.error(`- MCP Endpoint: http://localhost:${PORT}/mcp`);
  });

  return proxy.getServer()
}

startServer().catch(error => {
  if (error instanceof ValidationError) {
    console.error('Invalid OpenAPI 3.1 specification:')
    error.errors.forEach(err => console.error(err))
  } else {
    console.error('Error:', error)
  }
  process.exit(1)
})
