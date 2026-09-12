/* Ajustes da loja e, principalmente, o backup — a parte que salva o negócio
   se o celular quebrar, for roubado ou trocado. */
import { config, definirConfig, apagarMovimento, espacoUsado, listar } from '../db.js';
import {
  impressoraDisponivel, listarImpressoras, impressoraEscolhida, escolherImpressora, imprimirTeste
} from '../impressora.js';
import { estado, guardarSenha, recalcularPendencias } from '../app.js';
import {
  el, limpar, erro, sucesso, aviso, painel, confirmar, cartao, dataHora, anexar,
  tamanho, numero, dinheiro, vazio, $
} from '../ui.js';
import {
  gerarBackup, compartilharArquivo, baixarArquivo, lerArquivo, restaurar,
  enviarParaDrive, listarBackupsDrive, baixarDoDrive, autorizarDrive,
  statusBackup, registrarBackupLocal, driveConfigurado, driveDisponivel,
  dentroDoApp, PASTA_DRIVE
} from '../backup.js';

export async function render(raiz) {
  const corpo = el('div');
  raiz.appendChild(corpo);
  await desenhar();

  async function desenhar() {
    const [loja, status, espaco, intervalo, comFotos, temSenha, vendas, impressora] = await Promise.all([
      config('loja', {}), statusBackup(), espacoUsado(), config('intervaloBackup', 1),
      config('backupComFotos', true), config('senhaApp'), listar('vendas'), impressoraEscolhida()
    ]);

    anexar(limpar(corpo),
      /* ---------- Backup ---------- */
      cartao('☁️ Backup dos dados', el('div', { class: 'cartao-corpo' }, [
        status.ultimo
          ? el('div', { class: `aviso ${status.atrasado ? 'aviso-amarelo' : 'aviso-verde'}` },
              `${status.atrasado ? '⚠️' : '✅'} Último backup em ${dataHora(status.ultimo.em)} ` +
              `(${status.ultimo.destino === 'drive' ? 'Google Drive' : 'arquivo'}).`)
          : el('div', { class: 'aviso aviso-vermelho' },
              '⚠️ Nenhum backup feito ainda. Se este celular quebrar hoje, os dados se perdem.'),

        el('button', { class: 'btn btn-ok btn-bloco btn-gg mb', onclick: backupAgora },
          status.driveAtivo ? '☁️ Fazer backup no Google Drive' : '💾 Fazer backup agora'),

        el('div', { class: 'campo' }, [
          el('label', { text: 'Fazer backup automático a cada' }),
          el('select', { onchange: async (e) => { await definirConfig('intervaloBackup', Number(e.target.value)); recalcularPendencias(); } },
            [[1, 'Todo dia (recomendado)'], [3, 'A cada 3 dias'], [7, 'Toda semana'], [0, 'Não avisar']]
              .map(([v, t]) => el('option', { value: v, selected: intervalo === v, text: t })))
        ]),
        el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', checked: comFotos,
            onchange: (e) => definirConfig('backupComFotos', e.target.checked) }),
          el('span', { text: 'Incluir as fotos dos comprovantes (arquivo maior)' })
        ]),

        el('div', { class: 'grade2 mt' }, [
          driveDisponivel()
            ? el('button', { class: 'btn btn-vazio', onclick: configurarDrive },
                status.driveAtivo ? '⚙️ Google Drive' : '🔗 Ligar o Drive')
            : el('button', { class: 'btn btn-vazio', onclick: backupAgora }, '☁️ Enviar ao Drive'),
          el('button', { class: 'btn btn-vazio', onclick: restaurarBackup }, '↩️ Restaurar')
        ]),
        status.driveAtivo
          ? el('button', { class: 'btn btn-vazio btn-bloco mt', onclick: verBackupsDrive }, '📂 Ver backups no Drive')
          : el('div', { class: 'aviso aviso-azul mt' },
              dentroDoApp()
                ? 'Neste aplicativo o backup automático já grava uma cópia em ' +
                  'Downloads/LojaCaruaru todo dia. Para mandar ao Google Drive, toque no botão ' +
                  'acima e escolha o Drive na lista que abrir.'
                : 'Sem o Drive ligado, o backup abre o menu de compartilhamento do celular — ' +
                  'basta escolher o Google Drive na lista. Ligar o Drive faz isso sozinho.')
      ])),

      /* ---------- Loja ---------- */
      cartao('🏬 Dados da loja', el('div', { class: 'cartao-corpo' }, [
        el('div', { class: 'pq mudo mb', text: 'Aparecem no comprovante enviado ao cliente.' }),
        el('button', { class: 'btn btn-vazio btn-bloco', onclick: () => editarLoja(loja) },
          `${loja.nome || 'Loja Caruaru'}${loja.telefone ? ' · ' + loja.telefone : ''}`)
      ])),

      /* ---------- Impressora ---------- */
      cartao('🖨️ Impressora de cupom', el('div', { class: 'cartao-corpo' }, [
        impressoraDisponivel()
          ? el('div', {}, [
              el('div', { class: 'pq mudo mb', text: impressora
                ? `Imprimindo em: ${impressora.nome}`
                : 'Nenhuma impressora escolhida. Pareie a impressora nas configurações de Bluetooth do celular e escolha aqui.' }),
              el('button', { class: 'btn btn-vazio btn-bloco', onclick: escolherAImpressora },
                impressora ? 'Trocar impressora ou testar' : 'Escolher impressora')
            ])
          : el('div', { class: 'aviso aviso-azul', style: { margin: 0 } },
              'A impressão de cupom funciona no aplicativo instalado (APK), com uma impressora térmica Bluetooth pareada no celular.')
      ])),

      /* ---------- Segurança ---------- */
      cartao('🔒 Senha do aplicativo', el('div', { class: 'cartao-corpo' }, [
        el('div', { class: 'pq mudo mb', text: temSenha
          ? 'O aplicativo pede a senha toda vez que abre.'
          : 'Sem senha, quem pegar o celular vê o faturamento e o caixa da loja.' }),
        el('button', { class: `btn btn-bloco ${temSenha ? 'btn-vazio' : 'btn-primario'}`, onclick: () => definirSenha(temSenha) },
          temSenha ? 'Trocar ou remover a senha' : 'Criar senha de acesso')
      ])),

      /* ---------- Espaço e limpeza ---------- */
      cartao('🧹 Dados no aparelho', el('div', { class: 'cartao-corpo' }, [
        el('div', { class: 'pq mudo mb', text: espaco
          ? `${numero(vendas.length)} venda(s) · ${tamanho(espaco.usado)} usados neste celular.`
          : `${numero(vendas.length)} venda(s) registradas.` }),
        el('button', { class: 'btn btn-perigo btn-bloco', onclick: limparMovimento },
          'Apagar vendas, despesas e caixa')
      ]))
    );
  }

  /* ---------------- Backup ---------------- */
  async function backupAgora() {
    const comFotos = await config('backupComFotos', true);
    let arquivo;
    try {
      aviso('Preparando o backup…');
      arquivo = await gerarBackup({ incluirFotos: comFotos });
    } catch (e) { erro(`Não consegui montar o backup: ${e.message}`); return; }

    if (await driveConfigurado()) {
      try {
        await enviarParaDrive(arquivo);
        sucesso(`Backup enviado para o Google Drive (${tamanho(arquivo.tamanho)})`);
        desenhar(); recalcularPendencias();
        return;
      } catch (e) {
        erro(e.message);
        // continua para o compartilhamento manual, para o backup não ficar sem ser feito
      }
    }

    try {
      const destino = await compartilharArquivo(arquivo);
      await registrarBackupLocal(arquivo.nome);
      sucesso(
        dentroDoApp() ? 'Cópia salva no celular. Escolha o Google Drive na lista que abriu.'
        : destino === 'compartilhado' ? 'Escolha o Google Drive na lista para guardar o arquivo'
        : `Arquivo salvo no celular (${arquivo.nome})`);
      desenhar(); recalcularPendencias();
    } catch (e) {
      if (e.name === 'AbortError') return;              // o usuário desistiu, não é erro
      baixarArquivo(arquivo);
      await registrarBackupLocal(arquivo.nome);
      sucesso('Arquivo de backup baixado');
      desenhar();
    }
  }

  async function configurarDrive() {
    const clientId = el('input', {
      type: 'text', value: await config('googleClientId', '') || '',
      placeholder: '000000000000-xxxxxxxx.apps.googleusercontent.com'
    });

    painel({
      titulo: 'Google Drive',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' },
          `Com o Drive ligado, o backup vai sozinho para a pasta "${PASTA_DRIVE}" no Drive da loja. ` +
          'O aplicativo só enxerga os arquivos que ele mesmo criou — nada mais do seu Drive.'),
        el('div', { class: 'campo' }, [
          el('label', {}, ['ID do cliente do Google ', el('span', { class: 'dica', text: '— criado uma única vez' })]),
          clientId
        ]),
        el('details', { style: { fontSize: '13.5px' } }, [
          el('summary', { style: { fontWeight: '700', padding: '8px 0' }, text: 'Como conseguir esse ID (passo a passo)' }),
          el('ol', { style: { paddingLeft: '18px', lineHeight: '1.7' } }, [
            el('li', { html: 'Abra <b>console.cloud.google.com</b> com a conta Google da loja e crie um projeto (qualquer nome).' }),
            el('li', { html: 'No menu, vá em <b>APIs e serviços › Biblioteca</b>, procure <b>Google Drive API</b> e clique em <b>Ativar</b>.' }),
            el('li', { html: 'Em <b>Tela de permissão OAuth</b>, escolha <b>Externo</b>, preencha o nome do app e o seu e-mail, e adicione o e-mail da loja em <b>Usuários de teste</b>.' }),
            el('li', { html: 'Em <b>Credenciais › Criar credenciais › ID do cliente OAuth</b>, tipo <b>Aplicativo da Web</b>.' }),
            el('li', { html: `Em <b>Origens JavaScript autorizadas</b>, adicione exatamente: <b>${location.origin}</b>` }),
            el('li', { html: 'Copie o <b>ID do cliente</b> gerado e cole no campo acima.' })
          ]),
          el('p', { class: 'mudo', text: 'O Google vai mostrar um aviso de "app não verificado" na primeira autorização — é esperado para um aplicativo de uso próprio. Basta continuar.' })
        ])
      ]),
      acoes: [
        { rotulo: 'Salvar', acao: async (fechar) => {
          const valor = clientId.value.trim();
          await definirConfig('googleClientId', valor || null);
          if (!valor) await definirConfig('googleFolderId', null);
          sucesso(valor ? 'Google Drive configurado' : 'Google Drive desligado');
          fechar(); desenhar();
        } },
        { rotulo: 'Salvar e testar', class: 'btn-primario', acao: async (fechar) => {
          const valor = clientId.value.trim();
          if (!valor) { erro('Cole o ID do cliente primeiro'); return; }
          await definirConfig('googleClientId', valor);
          try {
            await autorizarDrive({ interativo: true });
            sucesso('Conectado ao Google Drive!');
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        } }
      ]
    });
  }

  async function verBackupsDrive() {
    const lista = el('div', { class: 'lista rolagem' }, el('div', { class: 'vazio', text: 'Consultando o Drive…' }));
    painel({ titulo: `Backups no Drive`, corpo: lista });
    try {
      const arquivos = await listarBackupsDrive();
      limpar(lista);
      if (!arquivos.length) { lista.appendChild(vazio('Nenhum backup no Drive ainda', '📂')); return; }
      for (const a of arquivos) {
        lista.appendChild(el('button', {
          class: 'item',
          onclick: async () => {
            if (!await confirmar(`Restaurar o backup de ${dataHora(a.createdTime)}? Os dados atuais deste celular serão substituídos.`, { perigo: true })) return;
            try {
              const conteudo = await baixarDoDrive(a.id);
              const n = await restaurar(conteudo, 'substituir');
              sucesso(`${numero(n)} registros restaurados`);
              setTimeout(() => location.reload(), 900);
            } catch (e) { erro(e.message); }
          }
        }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: dataHora(a.createdTime) }),
            el('div', { class: 'sub', text: `${a.name} · ${tamanho(Number(a.size) || 0)}` })
          ]),
          el('span', { class: 'pq negrito', style: { color: 'var(--azul-700)' }, text: 'Restaurar' })
        ]));
      }
    } catch (e) {
      limpar(lista).appendChild(el('div', { class: 'aviso aviso-vermelho', text: e.message }));
    }
  }

  function restaurarBackup() {
    const entrada = el('input', { type: 'file', accept: 'application/json,.json' });
    const modo = el('select', {}, [
      el('option', { value: 'substituir', text: 'Substituir tudo (usar em celular novo)' }),
      el('option', { value: 'juntar', text: 'Juntar com o que já existe' })
    ]);

    painel({
      titulo: 'Restaurar backup',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-amarelo' },
          'Restaurar substitui os dados deste celular pelos do arquivo. Se ainda não fez backup do que está aqui, faça antes.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Arquivo de backup (.json)' }), entrada]),
        el('div', { class: 'campo' }, [el('label', { text: 'Como restaurar' }), modo])
      ]),
      acoes: [{
        rotulo: 'Restaurar', class: 'btn-perigo', acao: async (fechar) => {
          const arquivo = entrada.files[0];
          if (!arquivo) { erro('Escolha o arquivo do backup'); return; }
          try {
            const conteudo = await lerArquivo(arquivo);
            if (!await confirmar(
              `Backup de ${dataHora(conteudo.geradoEm)}. Confirma a restauração?`, { perigo: true })) return;
            const n = await restaurar(conteudo, modo.value);
            sucesso(`${numero(n)} registros restaurados`);
            fechar();
            setTimeout(() => location.reload(), 900);
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  /* ---------------- Impressora ---------------- */
  async function escolherAImpressora() {
    const dispositivos = listarImpressoras();
    const atual = await impressoraEscolhida();
    const colunas = el('select', {}, [
      el('option', { value: '32', text: 'Bobina de 58 mm (32 colunas)' }),
      el('option', { value: '48', text: 'Bobina de 80 mm (48 colunas)' })
    ]);
    colunas.value = String(await config('impressoraColunas', 32));
    const semAcentos = el('input', { type: 'checkbox', checked: (await config('impressoraSemAcentos', true)) !== false });

    const lista = el('div', { class: 'lista' });
    let escolhida = atual;

    function desenharLista() {
      limpar(lista);
      if (!dispositivos.length) {
        anexar(lista, el('div', { class: 'aviso aviso-amarelo', style: { margin: '0' } },
          'Nenhuma impressora pareada. Abra Configurações › Bluetooth do celular, pareie a impressora e volte aqui.'));
        return;
      }
      for (const d of dispositivos) {
        anexar(lista, el('button', {
          class: 'item', onclick: () => { escolhida = d; desenharLista(); }
        }, [
          el('span', { style: { fontSize: '20px' }, text: '🖨️' }),
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: d.nome }),
            el('div', { class: 'sub', text: d.endereco })
          ]),
          escolhida?.endereco === d.endereco ? el('span', { class: 'etiqueta et-verde', text: '✓ escolhida' }) : null
        ]));
      }
    }
    desenharLista();

    painel({
      titulo: 'Impressora de cupom',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' },
          'A impressora precisa estar ligada e já pareada no Bluetooth do celular.'),
        lista,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Largura do papel' }), colunas]),
        el('label', { class: 'check' }, [semAcentos,
          el('span', { text: 'Imprimir sem acentos (compatível com mais impressoras)' })]),
        el('div', { class: 'pq mudo', text: 'Se o teste sair com símbolos estranhos no lugar dos acentos, mantenha esta opção ligada.' })
      ]),
      acoes: [
        { rotulo: '🖨️ Testar', acao: async () => {
          if (!escolhida) { erro('Escolha a impressora na lista'); return; }
          await definirConfig('impressoraColunas', Number(colunas.value));
          await definirConfig('impressoraSemAcentos', semAcentos.checked);
          try { aviso('Enviando teste…'); sucesso(await imprimirTeste(escolhida.endereco)); }
          catch (e) { erro(e.message); }
        } },
        { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          await escolherImpressora(escolhida || null);
          await definirConfig('impressoraColunas', Number(colunas.value));
          await definirConfig('impressoraSemAcentos', semAcentos.checked);
          sucesso(escolhida ? `Impressora: ${escolhida.nome}` : 'Impressora removida');
          fechar(); desenhar();
        } }
      ]
    });
  }

  /* ---------------- Loja, senha e limpeza ---------------- */
  function editarLoja(loja) {
    const nome = el('input', { type: 'text', value: loja.nome || '' });
    const telefone = el('input', { type: 'tel', value: loja.telefone || '' });
    painel({
      titulo: 'Dados da loja',
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Nome' }), nome]),
        el('div', { class: 'campo' }, [el('label', { text: 'WhatsApp / telefone' }), telefone])
      ]),
      acoes: [{
        rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          const dados = { nome: nome.value.trim() || 'Loja Caruaru', telefone: telefone.value.trim() };
          await definirConfig('loja', dados);
          estado.loja = dados;
          sucesso('Dados salvos'); fechar(); desenhar();
        }
      }]
    });
  }

  function definirSenha(temSenha) {
    const nova = el('input', { type: 'password', inputmode: 'numeric', placeholder: 'Mínimo 4 dígitos' });
    const repetir = el('input', { type: 'password', inputmode: 'numeric', placeholder: 'Repita' });
    painel({
      titulo: temSenha ? 'Trocar senha' : 'Criar senha',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-amarelo' },
          'Anote a senha em lugar seguro. Se esquecer, a única saída é reinstalar o aplicativo e restaurar o backup.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Nova senha' }), nova]),
        el('div', { class: 'campo' }, [el('label', { text: 'Repita a senha' }), repetir])
      ]),
      acoes: [
        temSenha ? { rotulo: 'Remover senha', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar('Remover a senha? Qualquer pessoa com o celular abrirá o aplicativo.', { perigo: true })) return;
          await guardarSenha(null); sucesso('Senha removida'); fechar(); desenhar();
        } } : null,
        { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (nova.value.length < 4) { erro('A senha precisa de ao menos 4 dígitos'); return; }
          if (nova.value !== repetir.value) { erro('As senhas não são iguais'); return; }
          await guardarSenha(nova.value);
          sucesso('Senha criada'); fechar(); desenhar();
        } }
      ].filter(Boolean)
    });
  }

  async function limparMovimento() {
    if (!await confirmar(
      'Isso apaga TODAS as vendas, despesas, comprovantes e o caixa deste celular. Produtos e clientes continuam. Faça o backup antes!',
      { perigo: true })) return;
    if (!await confirmar('Tem certeza mesmo? Não dá para desfazer.', { perigo: true })) return;
    await apagarMovimento();
    sucesso('Movimento apagado');
    setTimeout(() => location.reload(), 700);
  }
}
