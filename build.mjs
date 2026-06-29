import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await mkdir('dist/.openai', { recursive: true });

await Promise.all([
  cp('index.html', 'dist/index.html'),
  cp('styles.css', 'dist/styles.css'),
  cp('app.js', 'dist/app.js'),
  cp('.openai/hosting.json', 'dist/.openai/hosting.json'),
]);

const [html, css, js] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('styles.css', 'utf8'),
  readFile('app.js', 'utf8'),
]);

await writeFile(
  'dist/index.mjs',
  `const files = new Map(${JSON.stringify([
    ['/', { body: html, contentType: 'text/html; charset=utf-8' }],
    ['/index.html', { body: html, contentType: 'text/html; charset=utf-8' }],
    ['/styles.css', { body: css, contentType: 'text/css; charset=utf-8' }],
    ['/app.js', { body: js, contentType: 'application/javascript; charset=utf-8' }],
  ])});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const file = files.get(url.pathname) || files.get('/index.html');

    return new Response(file.body, {
      headers: {
        'content-type': file.contentType,
        'cache-control': 'no-store',
      },
    });
  },
};
`,
);
