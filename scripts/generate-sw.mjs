import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
const root = resolve('dist');
async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (entry.name !== 'sw.js') files.push(path);
  }
  return files;
}
const files = (await collect(root)).sort();
const hash = createHash('sha256').update('noema-static-cache-v2');
for (const path of files) hash.update(await readFile(path));
const version = `noema-${hash.digest('hex').slice(0,16)}`;
const urls = files.map(path => '/' + relative(root, path).replaceAll('\\','/'));
await writeFile(join(root, 'sw.js'), `const CACHE=${JSON.stringify(version)};\nconst ASSETS=${JSON.stringify(urls)};\nself.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});\nself.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('noema-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});\nself.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;event.respondWith(caches.match(event.request,{ignoreVary:true}).then(cached=>cached||fetch(event.request).catch(error=>{if(event.request.mode==='navigate')return caches.match('/index.html');throw error;})));});\n`);
console.log(`Offline cache: ${urls.length} assets, ${version}`);
