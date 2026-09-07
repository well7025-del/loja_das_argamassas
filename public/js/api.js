/** Cliente HTTP do ERP. Toda chamada devolve JSON e lanca Error com a mensagem do servidor. */
async function request(metodo, caminho, corpo) {
  const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const resposta = await fetch(caminho, opcoes);
  let dados = null;
  try { dados = await resposta.json(); } catch { dados = null; }
  if (!resposta.ok) {
    if (resposta.status === 401 && !caminho.includes('/auth/')) {
      document.dispatchEvent(new CustomEvent('sessao-expirada'));
    }
    throw new Error(dados?.error || `Erro ${resposta.status}`);
  }
  return dados;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (caminho, params) => request('GET', caminho + qs(params)),
  post: (caminho, corpo) => request('POST', caminho, corpo ?? {}),
  put: (caminho, corpo) => request('PUT', caminho, corpo ?? {}),
  del: (caminho) => request('DELETE', caminho)
};
