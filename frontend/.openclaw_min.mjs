const mermaid = (await import('mermaid')).default;
mermaid.initialize({ startOnLoad: false });
try {
  const { svg } = await mermaid.render('m1', 'flowchart TD\nA-->B');
  console.log('MIN_OK len=' + svg.length);
} catch (e) {
  console.log('MIN_ERR ' + (e && e.message));
}
