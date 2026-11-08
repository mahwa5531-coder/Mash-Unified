import assert from 'node:assert';
import React from 'react';
import { FileIcon } from '../src/primitives/FileIcon';
import {
  TypeScriptLogo,
  JavaScriptLogo,
  ReactLogo,
  RustLogo,
  GoLogo,
  CLogo,
  CppLogo,
  CSharpLogo,
  JavaLogo,
  KotlinLogo,
  SwiftLogo,
  RubyLogo,
  PhpLogo,
  VueLogo,
  SvelteLogo,
  AstroLogo,
  HtmlLogo,
  CssLogo,
  SassLogo,
  GraphqlLogo,
  PrismaLogo,
  ProtobufLogo,
  DockerLogo,
  GitLogo,
  EnvConfigLogo,
  ConfigSettingsLogo,
  TerraformLogo,
  MakefileLogo,
  FluentExcelLogo,
  FluentWordLogo,
  FluentPowerPointLogo,
  AdobePdfLogo,
  OfficialMarkdownLogo,
  CsvDelimitedLogo,
  JsonObjectLogo,
  SqlDatabaseLogo,
  ConsoleTerminalLogo,
  ZipArchiveLogo,
  ImageEvidenceLogo,
  MediaEvidenceLogo,
  AuthenticPythonLogo,
} from '../src/primitives/FileLogos';

console.log("--- STARTING FILE ICON & LOGO COMPREHENSIVE COVERAGE TESTS ---");

function getIconComponent(filename: string): any {
  const el = FileIcon({ filename });
  return (el as any)?.type;
}

// 1. Exact Filename Matches
console.log("[Suite 1: Exact Filenames]");
assert.strictEqual(getIconComponent('Dockerfile'), DockerLogo, "Dockerfile should map to DockerLogo");
assert.strictEqual(getIconComponent('.dockerignore'), DockerLogo, ".dockerignore should map to DockerLogo");
assert.strictEqual(getIconComponent('docker-compose.yml'), DockerLogo, "docker-compose.yml should map to DockerLogo");
assert.strictEqual(getIconComponent('.gitignore'), GitLogo, ".gitignore should map to GitLogo");
assert.strictEqual(getIconComponent('package.json'), JsonObjectLogo, "package.json should map to JsonObjectLogo");
assert.strictEqual(getIconComponent('tsconfig.json'), TypeScriptLogo, "tsconfig.json should map to TypeScriptLogo");
assert.strictEqual(getIconComponent('Cargo.toml'), RustLogo, "Cargo.toml should map to RustLogo");
assert.strictEqual(getIconComponent('go.mod'), GoLogo, "go.mod should map to GoLogo");
assert.strictEqual(getIconComponent('Makefile'), MakefileLogo, "Makefile should map to MakefileLogo");
assert.strictEqual(getIconComponent('requirements.txt'), AuthenticPythonLogo, "requirements.txt should map to AuthenticPythonLogo");
console.log("  ✓ All exact filename matches verified!");

// 2. Prefix Patterns
console.log("[Suite 2: Prefix Patterns]");
assert.strictEqual(getIconComponent('.env'), EnvConfigLogo, ".env should map to EnvConfigLogo");
assert.strictEqual(getIconComponent('.env.local'), EnvConfigLogo, ".env.local should map to EnvConfigLogo");
assert.strictEqual(getIconComponent('.env.production'), EnvConfigLogo, ".env.production should map to EnvConfigLogo");
assert.strictEqual(getIconComponent('dockerfile.dev'), DockerLogo, "dockerfile.dev should map to DockerLogo");
console.log("  ✓ All prefix pattern matches verified!");

// 3. Language & Framework Extensions
console.log("[Suite 3: Language & Framework Extensions]");
assert.strictEqual(getIconComponent('main.ts'), TypeScriptLogo, ".ts -> TypeScriptLogo");
assert.strictEqual(getIconComponent('index.js'), JavaScriptLogo, ".js -> JavaScriptLogo");
assert.strictEqual(getIconComponent('App.tsx'), ReactLogo, ".tsx -> ReactLogo");
assert.strictEqual(getIconComponent('Component.jsx'), ReactLogo, ".jsx -> ReactLogo");
assert.strictEqual(getIconComponent('script.py'), AuthenticPythonLogo, ".py -> AuthenticPythonLogo");
assert.strictEqual(getIconComponent('lib.rs'), RustLogo, ".rs -> RustLogo");
assert.strictEqual(getIconComponent('server.go'), GoLogo, ".go -> GoLogo");
assert.strictEqual(getIconComponent('main.c'), CLogo, ".c -> CLogo");
assert.strictEqual(getIconComponent('app.cpp'), CppLogo, ".cpp -> CppLogo");
assert.strictEqual(getIconComponent('Program.cs'), CSharpLogo, ".cs -> CSharpLogo");
assert.strictEqual(getIconComponent('Application.java'), JavaLogo, ".java -> JavaLogo");
assert.strictEqual(getIconComponent('Main.kt'), KotlinLogo, ".kt -> KotlinLogo");
assert.strictEqual(getIconComponent('App.swift'), SwiftLogo, ".swift -> SwiftLogo");
assert.strictEqual(getIconComponent('app.rb'), RubyLogo, ".rb -> RubyLogo");
assert.strictEqual(getIconComponent('index.php'), PhpLogo, ".php -> PhpLogo");
assert.strictEqual(getIconComponent('App.vue'), VueLogo, ".vue -> VueLogo");
assert.strictEqual(getIconComponent('App.svelte'), SvelteLogo, ".svelte -> SvelteLogo");
assert.strictEqual(getIconComponent('page.astro'), AstroLogo, ".astro -> AstroLogo");
assert.strictEqual(getIconComponent('index.html'), HtmlLogo, ".html -> HtmlLogo");
assert.strictEqual(getIconComponent('styles.css'), CssLogo, ".css -> CssLogo");
assert.strictEqual(getIconComponent('theme.scss'), SassLogo, ".scss -> SassLogo");
assert.strictEqual(getIconComponent('query.graphql'), GraphqlLogo, ".graphql -> GraphqlLogo");
assert.strictEqual(getIconComponent('schema.prisma'), PrismaLogo, ".prisma -> PrismaLogo");
assert.strictEqual(getIconComponent('service.proto'), ProtobufLogo, ".proto -> ProtobufLogo");
assert.strictEqual(getIconComponent('infra.tf'), TerraformLogo, ".tf -> TerraformLogo");
console.log("  ✓ All 24 core language/framework extensions verified!");

// 4. Documents & Data Formats
console.log("[Suite 4: Document & Data Formats]");
assert.strictEqual(getIconComponent('Report.xlsx'), FluentExcelLogo, ".xlsx -> FluentExcelLogo");
assert.strictEqual(getIconComponent('Memo.docx'), FluentWordLogo, ".docx -> FluentWordLogo");
assert.strictEqual(getIconComponent('Slides.pptx'), FluentPowerPointLogo, ".pptx -> FluentPowerPointLogo");
assert.strictEqual(getIconComponent('Audit_Opinion.pdf'), AdobePdfLogo, ".pdf -> AdobePdfLogo");
assert.strictEqual(getIconComponent('README.md'), OfficialMarkdownLogo, ".md -> OfficialMarkdownLogo");
assert.strictEqual(getIconComponent('transactions.csv'), CsvDelimitedLogo, ".csv -> CsvDelimitedLogo");
assert.strictEqual(getIconComponent('data.json'), JsonObjectLogo, ".json -> JsonObjectLogo");
assert.strictEqual(getIconComponent('query.sql'), SqlDatabaseLogo, ".sql -> SqlDatabaseLogo");
assert.strictEqual(getIconComponent('run.sh'), ConsoleTerminalLogo, ".sh -> ConsoleTerminalLogo");
assert.strictEqual(getIconComponent('deploy.ps1'), ConsoleTerminalLogo, ".ps1 -> ConsoleTerminalLogo");
assert.strictEqual(getIconComponent('evidence.png'), ImageEvidenceLogo, ".png -> ImageEvidenceLogo");
assert.strictEqual(getIconComponent('meeting.mp4'), MediaEvidenceLogo, ".mp4 -> MediaEvidenceLogo");
assert.strictEqual(getIconComponent('archive.zip'), ZipArchiveLogo, ".zip -> ZipArchiveLogo");
console.log("  ✓ All 13 document and data format extensions verified!");

// 5. Fallback Default
console.log("[Suite 5: Fallback & Robustness]");
const unknownEl = FileIcon({ filename: 'random_unrecognized_binary_data.xyz123' });
assert.ok(unknownEl, "Unrecognized file should render fallback");
assert.notStrictEqual((unknownEl as any)?.type, undefined);
console.log("  ✓ Fallback default works without throwing!");

console.log("======================================================");
console.log("✓ ALL 5 FILE ICON & LOGO SUITES PASSED (100% GREEN)!");
console.log("======================================================");
