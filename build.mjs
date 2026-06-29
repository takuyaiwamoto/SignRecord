import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await mkdir('dist/.openai', { recursive: true });

await Promise.all([
  cp('index.html', 'dist/index.html'),
  cp('styles.css', 'dist/styles.css'),
  cp('app.js', 'dist/app.js'),
  cp('.openai/hosting.json', 'dist/.openai/hosting.json'),
]);
