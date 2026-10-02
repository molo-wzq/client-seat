import http from 'node:http';
import { createServer } from 'vite';
import { createProductCore } from '../../src/domain/product-core';
import { InMemoryStorage } from '../../src/product/in-process-product-api';
import { FakeModelAdapter } from '../../src/adapters/fake-model-adapter';
import { createRequestListener } from '../../server/app-server';

const adapter = new FakeModelAdapter();
const core = createProductCore({ storage: new InMemoryStorage(), dialogue: adapter, copywriting: adapter });
await core.quickStart();
const server = http.createServer(createRequestListener({ core }));
await new Promise<void>((resolve) => server.listen(5191, '127.0.0.1', resolve));
const vite = await createServer({ server: { host: '127.0.0.1', port: 5190, strictPort: true, proxy: { '/api': 'http://127.0.0.1:5191' } } });
await vite.listen();
console.log('REVIEW ONLY: isolated in-memory storage, FakeModelAdapter; http://127.0.0.1:5190');
async function stop() { await vite.close(); server.close(); process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
