import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'url'

import { initProxy, ValidationError } from '../src/init-server'

const SERVER_NAME = 'Notion API'
const SERVER_VERSION = '1.0.0'

export async function startServer(args: string[] = process.argv.slice(2)) {
  const app = express();
  app.use(cors());

  app.get('/health', (_: any, res: any) => {
    res.json({ status: 'OK', server: SERVER_NAME, version: SERVER_VERSION });
  });
  app.get('/', (_: any, res: any) => {
    res.json({ status: 'OK', server: SERVER_NAME, version: SERVER_VERSION });
  });
  const transports: { [key: string]: SSEServerTransport } = {};

  const filename = fileURLToPath(import.meta.url)
  const directory = path.dirname(filename)
  const specPath = path.resolve(directory, '../scripts/notion-openapi.json')

  const baseUrl = process.env.BASE_URL ?? undefined
  const proxy = await initProxy(specPath, baseUrl)

  app.get("/sse", async (req: any, res: any) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const serverId = req.params.serverId
    console.log("serverId", serverId)

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const transport = new SSEServerTransport('/api/messages', res);
    const sessionId = transport.sessionId;
    console.error(`New SSE connection established: ${sessionId}`);
    transports[sessionId] = transport;

    req.on('close', () => {
      console.error(`SSE connection closed: ${sessionId}`);
      delete transports[sessionId];
    });

    await proxy.connect(transport)
  });

  app.post("/api/messages", async (req: any, res: any) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
      return res.status(400).send('Missing sessionId query parameter');
    }
    const transport = transports[sessionId];
    if (!transport) {
      return res.status(404).send('No active session found with the provided sessionId');
    }
    try {
      await transport.handlePostMessage(req, res);
    }
    catch (error) {
      console.error(`Error handling message for session ${sessionId}:`, error);
      // If the response hasn't been sent yet, send an error response
      if (!res.headersSent) {
        res.status(500).send('Internal server error processing message');
      }
    }
  });

  const PORT = 8080

  app.listen(PORT, () => {
    console.error(`MCP Web Server running at http://localhost:${PORT}`);
    console.error(`- SSE Endpoint: http://localhost:${PORT}/sse`);
    console.error(`- Messages Endpoint: http://localhost:${PORT}/api/messages?sessionId=YOUR_SESSION_ID`);
    console.error(`- Health Check: http://localhost:${PORT}/health`);
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
