import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pub = join(root, 'public');

if(!existsSync(join(dist, 'index.html'))) {
  throw new Error('dist/index.html is missing. Run vite build before prepare-github-pages.');
}

cpSync(join(pub, 'assets'), join(dist, 'assets'), {recursive: true});
cpSync(join(pub, 'changelogs'), join(dist, 'changelogs'), {recursive: true});

for(const name of ['browserconfig.xml', 'site.webmanifest', 'site_apple.webmanifest', 'version', 'embed.html', 'snapshot.html']) {
  const source = join(pub, name);
  if(existsSync(source)) copyFileSync(source, join(dist, name));
}

for(const name of readdirSync(pub)) {
  if(!name.endsWith('.svg')) continue;
  copyFileSync(join(pub, name), join(dist, name));
}

copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
writeFileSync(join(dist, '.nojekyll'), '');
writeFileSync(join(dist, 'CNAME'), 'web-echogram.mineholde.pro\n');
mkdirSync(dist, {recursive: true});
