import fs from 'fs';
const mermaid = (await import('mermaid')).default;
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
const code = fs.readFileSync('C:/Users/rama/Downloads/Mash/.openclaw_tmp_mermaid.mmd', 'utf8').trim();
try {
  const { svg } = await mermaid.render('g1', code);
  console.log('RENDER_OK svg_len=' + svg.length);
} catch (e) {
  console.log('RENDER_ERROR');
  console.log('name=' + (e && e.name));
  console.log('message=' + (e && e.message));
  if (e && e.str) console.log('str=' + e.str);
  if (e && e.hash) console.log('hash=' + e.hash);
}
