/* ============================================================
   Peças de tela usadas no PDV e na alteração de venda: a escolha da
   forma de pagamento (uma ou várias) e o desconto num item.
   ============================================================ */
import { el, limpar, dinheiro, percentual, erro, painel, anexar } from './ui.js';
import { FORMAS_PAGAMENTO, centavos, normalizarPagamentos, validarPagamentos, valorDoDesconto } from './regras.js';

/**
 * Forma de pagamento. Começa no modo simples (um toque escolhe a forma, como
 * sempre foi); "Dividir o pagamento" abre um campo de valor para cada forma,
 * com o quanto falta sempre à vista e um botão que joga o restante na forma
 * tocada.
 *
 * `total` é uma função, porque o total muda enquanto o pedido é editado.
 */
export function editorPagamentos({ total, inicial = null, aoMudar = null }) {
  const caixa = el('div');
  let dividido = false;
  let unica = 'dinheiro';
  const valores = new Map(FORMAS_PAGAMENTO.map(f => [f.id, 0]));

  const lista = normalizarPagamentos(inicial || []);
  if (lista.length > 1) {
    dividido = true;
    for (const p of lista) valores.set(p.forma, p.valor);
  } else if (lista.length === 1) {
    unica = lista[0].forma;
  } else if (inicial?.[0]?.forma) {
    unica = inicial[0].forma;
  }

  const soma = () => centavos([...valores.values()].reduce((a, v) => a + v, 0));
  const avisar = () => aoMudar?.();

  function desenhar() {
    limpar(caixa);
    const t = centavos(total());
    if (!dividido) {
      const grade = el('div', { class: 'pagamentos' });
      for (const f of FORMAS_PAGAMENTO) {
        anexar(grade, el('button', {
          class: `pag ${unica === f.id ? 'ativo' : ''}`, type: 'button',
          onclick: () => { unica = f.id; desenhar(); avisar(); }
        }, `${f.icone} ${f.rotulo}`));
      }
      anexar(caixa, grade, el('button', {
        class: 'btn btn-vazio btn-sm btn-bloco mt', type: 'button',
        onclick: () => {
          dividido = true;
          for (const f of FORMAS_PAGAMENTO) valores.set(f.id, 0);
          valores.set(unica, t);
          desenhar(); avisar();
        }
      }, '➗ Dividir o pagamento em mais de uma forma'));
      return;
    }

    const resumo = el('div', { class: 'aviso', style: { margin: '8px 0 0' } });
    const atualizarResumo = () => {
      const falta = centavos(centavos(total()) - soma());
      resumo.className = `aviso ${Math.abs(falta) < 0.01 ? 'aviso-verde' : 'aviso-amarelo'}`;
      resumo.textContent = Math.abs(falta) < 0.01
        ? `✅ Pagamento fecha com o total de ${dinheiro(total())}`
        : falta > 0 ? `Falta ${dinheiro(falta)} de ${dinheiro(total())}` : `Passou ${dinheiro(-falta)} do total`;
    };

    const linhas = el('div', { class: 'lista' });
    const campos = new Map();
    for (const f of FORMAS_PAGAMENTO) {
      const entrada = el('input', {
        type: 'number', inputmode: 'decimal', min: '0', step: '0.01', placeholder: '0,00',
        value: valores.get(f.id) ? String(valores.get(f.id)) : '',
        style: { maxWidth: '120px', textAlign: 'right' },
        oninput: (e) => { valores.set(f.id, Math.max(0, Number(e.target.value) || 0)); atualizarResumo(); avisar(); }
      });
      campos.set(f.id, entrada);
      anexar(linhas, el('div', { class: 'item' }, [
        el('div', { class: 'info' }, [el('div', { class: 'titulo', text: `${f.icone} ${f.rotulo}` })]),
        el('button', {
          class: 'btn btn-vazio btn-sm', type: 'button', title: 'Pôr aqui o que falta',
          onclick: () => {
            const outras = centavos(soma() - valores.get(f.id));
            const resto = Math.max(0, centavos(centavos(total()) - outras));
            valores.set(f.id, resto);
            entrada.value = resto ? String(resto) : '';
            atualizarResumo(); avisar();
          }
        }, 'restante'),
        entrada
      ]));
    }
    anexar(caixa, linhas, resumo, el('button', {
      class: 'btn btn-vazio btn-sm btn-bloco mt', type: 'button',
      onclick: () => {
        // volta para a forma com mais valor
        unica = [...valores.entries()].sort((a, b) => b[1] - a[1])[0][1] > 0
          ? [...valores.entries()].sort((a, b) => b[1] - a[1])[0][0] : unica;
        dividido = false; desenhar(); avisar();
      }
    }, 'Voltar para uma forma só'));
    atualizarResumo();
  }

  desenhar();

  return {
    elemento: caixa,
    redesenhar: desenhar,
    /** Lista final [{ forma, valor }]. No modo simples, o total inteiro na forma escolhida. */
    valor: () => dividido
      ? normalizarPagamentos([...valores.entries()].map(([forma, valor]) => ({ forma, valor })))
      : [{ forma: unica, valor: centavos(total()) }],
    /** Mensagem do que falta acertar, ou null. */
    problema: () => (centavos(total()) > 0 ? validarPagamentos(
      dividido ? normalizarPagamentos([...valores.entries()].map(([forma, valor]) => ({ forma, valor })))
               : [{ forma: unica, valor: centavos(total()) }],
      centavos(total())) : null),
    dividido: () => dividido
  };
}

/**
 * Desconto num item do pedido, em % ou em R$, com a prévia do valor final da
 * linha. `base` é o valor da linha já com o desconto de quantidade.
 */
export function painelDescontoItem({ nome, base, regra = null, aoAplicar }) {
  let tipo = regra?.tipo || 'percentual';
  const entrada = el('input', {
    type: 'number', inputmode: 'decimal', min: '0', step: '0.01',
    value: regra?.valor ? String(regra.valor) : '', placeholder: '0'
  });
  const botoes = el('div', { class: 'pagamentos', style: { gridTemplateColumns: '1fr 1fr' } });
  const previa = el('div', { class: 'aviso aviso-azul mt' });

  const regraAtual = () => ({ tipo, valor: Math.max(0, Number(entrada.value) || 0) });
  function desenharPrevia() {
    const r = regraAtual();
    const desc = valorDoDesconto(r, base);
    const pct = base > 0 ? desc / base * 100 : 0;
    previa.textContent = desc > 0
      ? `${dinheiro(base)} − ${dinheiro(desc)} (${percentual(pct)}) = ${dinheiro(base - desc)}`
      : `Linha sem desconto: ${dinheiro(base)}`;
    if (r.tipo === 'percentual' && r.valor > 100) previa.textContent = 'O desconto não pode passar de 100%';
    if (r.tipo === 'valor' && r.valor > base) previa.textContent = `O desconto não pode passar de ${dinheiro(base)}`;
  }
  function desenharBotoes() {
    limpar(botoes);
    for (const [id, rotulo] of [['percentual', '% sobre o item'], ['valor', 'R$ no item']]) {
      anexar(botoes, el('button', {
        class: `pag ${tipo === id ? 'ativo' : ''}`, type: 'button',
        onclick: () => { tipo = id; desenharBotoes(); desenharPrevia(); entrada.focus(); }
      }, rotulo));
    }
  }
  entrada.addEventListener('input', desenharPrevia);

  const { fechar } = painel({
    titulo: `Desconto — ${nome}`,
    corpo: el('div', {}, [
      botoes,
      el('div', { class: 'campo mt' }, [el('label', { text: 'Desconto' }), entrada]),
      previa
    ]),
    acoes: [
      regra ? { rotulo: 'Tirar desconto', acao: (f) => { aoAplicar(null); f(); } } : null,
      {
        rotulo: 'Aplicar', class: 'btn-primario', acao: (f) => {
          const r = regraAtual();
          if (r.tipo === 'percentual' && r.valor > 100) { erro('O desconto não pode passar de 100%'); return; }
          if (r.tipo === 'valor' && r.valor > base) { erro(`O desconto não pode passar de ${dinheiro(base)}`); return; }
          aoAplicar(r.valor > 0 ? r : null);
          f();
        }
      }
    ].filter(Boolean)
  });
  desenharBotoes(); desenharPrevia();
  setTimeout(() => entrada.focus(), 80);
  return { fechar };
}
