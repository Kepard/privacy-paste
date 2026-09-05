document.getElementById('scan').addEventListener('click', async () => {
  const out = document.getElementById('output');
  out.textContent = 'Scanning locally…';
  try {
    const result = await chrome.runtime.sendMessage({ target: 'background', type: 'filter', text: document.getElementById('sample').textContent });
    out.textContent = result?.ok ? `${result.hidden} sensitive items hidden\n\n${result.text}` : `Blocked: ${result?.code || 'engine unavailable'}. Load the model from the popup first.`;
  } catch { out.textContent = 'Local engine unavailable. Reload the extension.'; }
});
document.getElementById('clear').addEventListener('click', () => {
  document.getElementById('plain').value = ''; document.getElementById('single').value = '';
  document.getElementById('rich').replaceChildren(); document.getElementById('output').textContent = 'Results will appear here.';
});
