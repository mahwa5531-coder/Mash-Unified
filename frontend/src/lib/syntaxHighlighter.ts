import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import ts from 'shiki/langs/typescript.mjs';
import js from 'shiki/langs/javascript.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import py from 'shiki/langs/python.mjs';
import sql from 'shiki/langs/sql.mjs';
import json from 'shiki/langs/json.mjs';
import bash from 'shiki/langs/bash.mjs';
import htmlLang from 'shiki/langs/html.mjs';
import css from 'shiki/langs/css.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import md from 'shiki/langs/markdown.mjs';
import rust from 'shiki/langs/rust.mjs';
import go from 'shiki/langs/go.mjs';
import c from 'shiki/langs/c.mjs';
import cpp from 'shiki/langs/cpp.mjs';
import csharp from 'shiki/langs/csharp.mjs';
import java from 'shiki/langs/java.mjs';
import docker from 'shiki/langs/dockerfile.mjs';
import diff from 'shiki/langs/diff.mjs';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const mashTheme = createCssVariablesTheme({
  name: 'mash-theme',
  variablePrefix: '--shiki-',
});

const highlighter = createHighlighterCoreSync({
  themes: [mashTheme],
  langs: [
    ts, js, jsx, tsx, py, sql, json, bash,
    htmlLang, css, yaml, md, rust, go, c,
    cpp, csharp, java, docker, diff
  ],
  engine: createJavaScriptRegexEngine(),
});

const loadedLanguages = new Set(highlighter.getLoadedLanguages());

const ALIAS_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  golang: 'go',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  docker: 'dockerfile',
  md: 'markdown',
};

export function highlightCodeSnippet(rawCode: string, language: string, isDark: boolean): string {
  if (!rawCode) return '';
  const lang = (language || '').toLowerCase().trim();

  if (lang === 'text' || lang === 'plain' || lang === 'txt') {
    return escapeHtml(rawCode);
  }

  const resolved = loadedLanguages.has(lang)
    ? lang
    : ALIAS_MAP[lang] && loadedLanguages.has(ALIAS_MAP[lang])
    ? ALIAS_MAP[lang]
    : null;

  if (!resolved) {
    return escapeHtml(rawCode);
  }

  try {
    const rawHtml = highlighter.codeToHtml(rawCode, {
      lang: resolved,
      theme: 'mash-theme',
      transformers: [
        {
          span(node) {
            const style = String((node.properties as any)?.style || '');
            if (style.includes('keyword')) {
              (node.properties as any).class = isDark ? 'text-purple-400 font-medium' : 'text-purple-600 font-medium';
              delete (node.properties as any).style;
            } else if (style.includes('comment')) {
              (node.properties as any).class = isDark ? 'text-zinc-500 italic' : 'text-zinc-400 italic';
              delete (node.properties as any).style;
            } else if (style.includes('string')) {
              (node.properties as any).class = isDark ? 'text-emerald-400' : 'text-emerald-600';
              delete (node.properties as any).style;
            } else if (style.includes('constant')) {
              (node.properties as any).class = isDark ? 'text-amber-400' : 'text-amber-600';
              delete (node.properties as any).style;
            } else if (style.includes('function')) {
              (node.properties as any).class = isDark ? 'text-sky-400 font-medium' : 'text-sky-600 font-medium';
              delete (node.properties as any).style;
            } else if (style.includes('punctuation')) {
              (node.properties as any).class = isDark ? 'text-zinc-400' : 'text-zinc-600';
              delete (node.properties as any).style;
            } else if (style.includes('parameter')) {
              (node.properties as any).class = isDark ? 'text-orange-400' : 'text-orange-600';
              delete (node.properties as any).style;
            }
          },
        },
      ],
    });

    return rawHtml.replace(/^<pre[^>]*><code[^>]*>/, '').replace(/<\/code><\/pre>$/, '');
  } catch {
    return escapeHtml(rawCode);
  }
}
