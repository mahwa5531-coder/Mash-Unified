// Canonical test runner delegating to TypeScript suite importing real production splitMarkdownBlocks
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsFile = path.join(__dirname, 'test_virtualized_markdown_logic.ts');

execFileSync('npx', ['tsx', tsFile], { stdio: 'inherit', shell: true });
