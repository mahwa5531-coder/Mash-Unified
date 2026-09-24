import fs from 'fs';
const mermaid = (await import('mermaid')).default;
mermaid.initialize({ startOnLoad: false });
const code = fs.readFileSync('C:/Users/rama/Downloads/Mash/.openclaw_tmp_mermaid.mmd', 'utf8').trim();
try {
  const res = await mermaid.parse(code);
  console.log('PARSE_OK type=' + (res && res.diagramType));
} catch (e) {
  console.log('PARSE_ERROR');
  try { console.log('message=' + e.message); } catch {}
  try { console.log('str=' + e.str); } catch {}
  try { console.log('hash=' + e.hash); } catch {}
  // try to dump str
  if (e && typeof e === 'object') { for (const k of Object.keys(e)) { const v=e[k]; if (typeof v!=='object') console.log('  field '+k+' = '+String(v).slice(0,300)); } }
}
