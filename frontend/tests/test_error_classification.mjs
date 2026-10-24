// Canonical test runner delegating to TypeScript suite importing real production module
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsFile = path.join(__dirname, 'test_error_classification.ts');

execFileSync('npx', ['tsx', tsFile], { stdio: 'inherit', shell: true });
