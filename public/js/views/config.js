/* Configuracoes (somente master): lojas, usuarios, dados da empresa e notificacoes. */
import { api } from '../api.js';
import { estado, ehMaster } from '../app.js';
import { el, limpar, erro, sucesso, modal, vazio, dataBR, confirmar } from '../ui.js';

const PAPEIS = { master: 'Master (todas as lojas)', gerente: 'Gerente da loja', vendedor: 'Vendedor' };

export async function render(raiz) {
  if (!ehMaster()) {
    raiz.appendChild(el('div', { class: 'aviso aviso-amarelo' }, 'Área exclusiva do usuário master.'));
    return;
  }

  const abas = ['Lojas e unidades', 'Usuários', 'Empresa', 'Notificações'];
  let aba = 0;
  const conteudo = el('div');
  const barra = el('div', { class: 'pdv-categorias mb' }, abas.map((nome, i) =>
    el('button', { class: `chip ${i === 0 ? 'ativo' : ''}`, type: 'button', onclick: () => {
      aba = i;
      [...barra.children].forEach((c, j) => c.classList.toggle('ativo', j === i));
      desenhar();
    } }, nome)));

  raiz.append(barra, conteudo);

  async function desenhar() {
    limpar(conteudo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    if (aba === 0) await abaLojas();
    else if (aba === 1) await abaUsuarios();
    else if (aba === 2) await abaEmpresa();
    else await abaNotificacoes();
  }

  /* ---------- Lojas ---------- */
  async function abaLojas() {
    const { lojas } = await api.get('/api/lojas');
    limpar(conteudo).append(
      el('div', { class: 'flex quebra mb', style: { justifyContent: 'space-between' } }, [
        el('div', { class: 'pequeno texto-mudo', text: 'Cadastre quantas lojas quiser. Unidades do tipo fábrica produzem e abastecem as lojas; unidades do tipo loja vendem no PDV e têm caixa próprio.' }),
        el('button', { class: 'btn btn-acao', onclick: () => formLoja() }, '+ Nova unidade')
      ]),
      el('div', { class: 'grid g3' }, lojas.map(l => el('div', { class: 'card' }, [
        el('div', { class: 'card-cab' }, [
          el('h3', { text: `${l.kind === 'fabrica' ? '🏭' : '🏬'} ${l.name}` }),
          el('div', { class: 'espaco' }),
          el('span', { class: `tag ${l.active ? 'tag-verde' : 'tag-cinza'}`, text: l.active ? 'Ativa' : 'Inativa' })
        ]),
        el('div', { class: 'card-corpo' }, [
          el('div', { class: 'pequeno', text: l.address || 'Sem endereço cadastrado' }),
          el('div', { class: 'pequeno texto-mudo', text: [l.city, l.uf, l.cep].filter(Boolean).join(' · ') }),
          el('div', { class: 'pequeno texto-mudo', text: `Código: ${l.code} · ${l.usuarios || 0} usuário(s)` }),
          el('button', { class: 'btn btn-vazio btn-sm mt', onclick: () => formLoja(l) }, 'Editar')
        ])
      ])))
    );
  }

  function formLoja(loja = null) {
    const campos = {
      name: el('input', { type: 'text', value: loja?.name || '' }),
      city: el('input', { type: 'text', value: loja?.city || '' }),
      uf: el('input', { type: 'text', value: loja?.uf || 'PE', maxlength: '2' }),
      address: el('input', { type: 'text', value: loja?.address || '' }),
      cep: el('input', { type: 'text', value: loja?.cep || '' }),
      phone: el('input', { type: 'tel', value: loja?.phone || '' })
    };
    const tipo = el('select', {}, [
      el('option', { value: 'loja', selected: loja?.kind !== 'fabrica', text: '🏬 Loja (vende no PDV, tem caixa)' }),
      el('option', { value: 'fabrica', selected: loja?.kind === 'fabrica', text: '🏭 Fábrica (produz e abastece as lojas)' })
    ]);
    const ativa = el('input', { type: 'checkbox', checked: loja ? !!loja.active : true });

    modal({
      titulo: loja ? `Editar ${loja.name}` : 'Nova unidade', largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Nome *' }), campos.name]),
          el('div', { class: 'campo' }, [el('label', { text: 'Tipo' }), loja ? el('input', { type: 'text', value: loja.kind === 'fabrica' ? 'Fábrica' : 'Loja', disabled: true }) : tipo])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Endereço' }), campos.address]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Cidade' }), campos.city]),
          el('div', { class: 'campo', style: { flex: '.4' } }, [el('label', { text: 'UF' }), campos.uf]),
          el('div', { class: 'campo' }, [el('label', { text: 'CEP' }), campos.cep]),
          el('div', { class: 'campo' }, [el('label', { text: 'Telefone' }), campos.phone])
        ]),
        loja ? el('label', { class: 'check' }, [ativa, el('span', { text: 'Unidade ativa' })]) : null
      ]),
      acoes: [{
        rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!campos.name.value.trim()) { erro('Informe o nome da unidade'); return; }
          const dados = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.value]));
          try {
            if (loja) await api.put(`/api/lojas/${loja.id}`, { ...dados, active: ativa.checked });
            else await api.post('/api/lojas', { ...dados, kind: tipo.value });
            sucesso(loja ? 'Unidade atualizada' : 'Unidade criada');
            fechar();
            location.reload();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  /* ---------- Usuarios ---------- */
  async function abaUsuarios() {
    const { usuarios } = await api.get('/api/usuarios');
    limpar(conteudo).append(
      el('div', { class: 'flex quebra mb', style: { justifyContent: 'space-between' } }, [
        el('div', { class: 'pequeno texto-mudo', text: 'Cada gerente só enxerga a própria loja. O master enxerga todas e é o único que cadastra produtos e define custo e preço.' }),
        el('button', { class: 'btn btn-acao', onclick: () => formUsuario() }, '+ Novo usuário')
      ]),
      el('div', { class: 'card' }, el('div', { class: 'tabela-wrap' }, el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Usuário' }), el('th', { text: 'E-mail' }), el('th', { text: 'Perfil' }),
          el('th', { text: 'Loja' }), el('th', { text: 'Avisos' }), el('th', { text: 'Desde' }), el('th', { text: '' })
        ])),
        el('tbody', {}, usuarios.map(u => el('tr', {}, [
          el('td', {}, [
            el('div', { class: 'negrito', text: u.name }),
            !u.active ? el('span', { class: 'tag tag-cinza', text: 'Inativo' }) : null
          ]),
          el('td', { class: 'pequeno', text: u.email }),
          el('td', {}, el('span', { class: `tag ${u.role === 'master' ? 'tag-amarelo' : 'tag-azul'}`, text: PAPEIS[u.role] || u.role })),
          el('td', { class: 'pequeno', text: u.store_name || 'Todas' }),
          el('td', { class: 'pequeno', text: u.notify_low_stock ? '🔔 sim' : '—' }),
          el('td', { class: 'pequeno texto-mudo', text: dataBR(u.created_at) }),
          el('td', { class: 'num' }, el('button', { class: 'btn btn-sm btn-vazio', onclick: () => formUsuario(u) }, 'Editar'))
        ])))
      ])))
    );
  }

  function formUsuario(usuario = null) {
    const nome = el('input', { type: 'text', value: usuario?.name || '' });
    const email = el('input', { type: 'email', value: usuario?.email || '', disabled: !!usuario });
    const telefone = el('input', { type: 'tel', value: usuario?.phone || '' });
    const senha = el('input', { type: 'password', placeholder: usuario ? 'Deixe em branco para manter' : 'Mínimo 6 caracteres' });
    const papel = el('select', {}, Object.entries(PAPEIS).map(([k, v]) => el('option', { value: k, selected: usuario?.role === k, text: v })));
    const loja = el('select', {}, [
      el('option', { value: '', text: 'Nenhuma (apenas master)' }),
      ...estado.lojas.map(l => el('option', { value: l.id, selected: usuario?.store_id === l.id, text: l.name }))
    ]);
    const ativo = el('input', { type: 'checkbox', checked: usuario ? !!usuario.active : true });
    const notifica = el('input', { type: 'checkbox', checked: usuario ? !!usuario.notify_low_stock : true });

    const atualizarLoja = () => { loja.disabled = papel.value === 'master'; };
    papel.addEventListener('change', atualizarLoja); atualizarLoja();

    modal({
      titulo: usuario ? `Editar ${usuario.name}` : 'Novo usuário', largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Nome *' }), nome]),
          el('div', { class: 'campo' }, [el('label', { text: 'Telefone' }), telefone])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'E-mail (login) *' }), email]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Perfil' }), papel]),
          el('div', { class: 'campo' }, [el('label', { text: 'Loja' }), loja])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: usuario ? 'Nova senha' : 'Senha *' }), senha]),
        el('label', { class: 'check mb' }, [notifica, el('span', { text: 'Receber avisos de estoque mínimo' })]),
        usuario ? el('label', { class: 'check' }, [ativo, el('span', { text: 'Usuário ativo' })]) : null
      ]),
      acoes: [{
        rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          const dados = {
            name: nome.value, phone: telefone.value, role: papel.value,
            store_id: papel.value === 'master' ? null : (loja.value || null),
            notify_low_stock: notifica.checked, active: ativo.checked
          };
          if (senha.value) dados.password = senha.value;
          try {
            if (usuario) await api.put(`/api/usuarios/${usuario.id}`, dados);
            else await api.post('/api/usuarios', { ...dados, email: email.value, password: senha.value });
            sucesso(usuario ? 'Usuário atualizado' : 'Usuário criado');
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  /* ---------- Empresa ---------- */
  async function abaEmpresa() {
    const cfg = await api.get('/api/config');
    const e = cfg.empresa || {};
    const campos = {
      nome: el('input', { type: 'text', value: e.nome || '' }),
      slogan: el('input', { type: 'text', value: e.slogan || '' }),
      telefone: el('input', { type: 'tel', value: e.telefone || '' }),
      whatsapp: el('input', { type: 'tel', value: e.whatsapp || '', placeholder: '5581999999999' }),
      email: el('input', { type: 'email', value: e.email || '' }),
      endereco: el('input', { type: 'text', value: e.endereco || '' })
    };
    limpar(conteudo).append(el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [el('h3', { text: 'Dados da empresa' })]),
      el('div', { class: 'card-corpo' }, [
        el('div', { class: 'pequeno texto-mudo mb', text: 'Estes dados aparecem no comprovante enviado ao cliente e no catálogo online.' }),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Nome' }), campos.nome]),
          el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Slogan' }), campos.slogan])
        ]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Telefone' }), campos.telefone]),
          el('div', { class: 'campo' }, [el('label', {}, ['WhatsApp ', el('span', { class: 'dica', text: '— com 55 e DDD' })]), campos.whatsapp]),
          el('div', { class: 'campo' }, [el('label', { text: 'E-mail' }), campos.email])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Endereço' }), campos.endereco]),
        el('button', { class: 'btn btn-primario', onclick: async () => {
          try {
            await api.put('/api/config', { empresa: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.value])) });
            sucesso('Dados salvos');
          } catch (err) { erro(err.message); }
        } }, 'Salvar')
      ])
    ]));
  }

  /* ---------- Notificacoes ---------- */
  async function abaNotificacoes() {
    const cfg = await api.get('/api/config');
    const n = cfg.notificacoes || {};
    const ativo = el('input', { type: 'checkbox', checked: n.estoque_minimo !== false });
    const percentual = el('input', { type: 'number', min: '10', max: '300', value: n.percentual_alerta ?? 100 });
    const caixa = el('input', { type: 'number', min: '0', step: '100', value: n.alerta_caixa_alto ?? 3000 });

    limpar(conteudo).append(el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [el('h3', { text: 'Avisos automáticos' })]),
      el('div', { class: 'card-corpo' }, [
        el('label', { class: 'check mb' }, [ativo, el('span', { text: 'Avisar todos os usuários quando um produto chegar ao estoque mínimo' })]),
        el('div', { class: 'campo' }, [
          el('label', {}, ['Disparar o aviso em ', el('span', { class: 'dica', text: '% do estoque mínimo (100% = exatamente no mínimo; 150% = avisa antes)' })]),
          percentual
        ]),
        el('div', { class: 'campo' }, [
          el('label', {}, ['Avisar quando o caixa da loja passar de (R$) ', el('span', { class: 'dica', text: '— lembra de depositar na matriz. 0 desativa.' })]),
          caixa
        ]),
        el('div', { class: 'aviso aviso-azul mb' },
          'Cada usuário também pode ligar ou desligar os próprios avisos em "Minha conta". Os alertas aparecem no sino do topo e no painel inicial.'),
        el('button', { class: 'btn btn-primario', onclick: async () => {
          try {
            await api.put('/api/config', { notificacoes: {
              estoque_minimo: ativo.checked,
              percentual_alerta: Number(percentual.value),
              alerta_caixa_alto: Number(caixa.value)
            } });
            sucesso('Configuração salva');
          } catch (err) { erro(err.message); }
        } }, 'Salvar')
      ])
    ]));
  }

  desenhar();
}
