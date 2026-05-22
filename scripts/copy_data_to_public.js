import { cpSync, mkdirSync, existsSync } from 'node:fs';
mkdirSync('public/data', { recursive: true });
if (existsSync('data')) {
  cpSync('data', 'public/data', { recursive: true });
  console.log('data/ copied to public/data/');
} else {
  console.log('data/ does not exist yet — nothing to copy');
}
