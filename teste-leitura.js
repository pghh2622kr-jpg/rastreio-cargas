// Confere a leitura das páginas com exemplos no mesmo formato dos sites (sem acessar a internet).
const assert = require('assert');
const { lerSSW, lerBraspress, lerTgex } = require('./transportadoras');

const ssw = lerSSW(`<table><tr><td>N Fiscal/Coleta<br>N Pedido</td><td>Unidade<br>Data/hora</td><td>Situação</td></tr>
<tr><td><a>1</a> 016771</td><td>SAO PAULO / SP<br>04/11/26 09:27</td><td><p class="titulo">DOCUMENTO DE TRANSPORTE EMITIDO (GEN CWG 520)</p>Redespacho autorizado com 5 volumes. Destino: ES/VITORIA. Previsao de entrega: 16/11/26. Mais detalhes</td></tr>
<tr><td><a>1</a> 016681</td><td>RIO DE JANEIRO / RJ<br>27/10/26 14:58</td><td><p class="titulo">MERCADORIA ENTREGUE (GEN RJ1 01)</p>ENTREGA REALIZADA (SSWMOBILE)</td></tr>
<tr><td>016781</td><td></td><td>Informação não disponível</td></tr></table>`);
assert.deepStrictEqual(ssw['16771'], { status: 'DOCUMENTO DE TRANSPORTE EMITIDO', local: 'SAO PAULO / SP', quando: '04/11/26 09:27', previsao: '2026-11-16', entregue: false, dataEntrega: '' });
assert.strictEqual(ssw['16681'].entregue, true);
assert.strictEqual(ssw['16681'].dataEntrega, '2026-10-27');
assert.strictEqual(ssw['16781'], undefined);

const evs = [['ENCOMENDA NA FILIAL ORIGEM - PATO BRANCO - PR', '19/10/2026 21:14'], ['ENCOMENDA NA FILIAL DE DESTINO - RIBEIRAO PRETO - SP', '28/10/2026 06:24'], ['ENCOMENDA EM PROCESSO DE ENTREGA', '30/10/2026 12:19'], ['DESTINATARIO FECHADO', '']]
  .map(([t, d]) => `<div><div class="vertical-time-line-info">${t}</div><div class="vertical-time-line-date">${d}</div></div>`).join('');
const br = lerBraspress(`<table><tr><td class="dt-nf">16679</td><td class="dt-previsao-entrega">21/10/2026</td><td class="dt-status">Pendente de Entrega</td><td class="dt-data-entrega"></td></tr></table>${evs}${evs}`);
assert.strictEqual(br.entregue, false);
assert.strictEqual(br.previsao, '2026-10-21');
assert.strictEqual(br.local, 'RIBEIRAO PRETO - SP');
assert.strictEqual(br.quando, '30/10/2026 12:19');
assert.ok(br.status.startsWith('Pendente de Entrega – DESTINATARIO FECHADO'));
const br2 = lerBraspress(`<table><tr><td class="dt-nf">16730</td><td class="dt-previsao-entrega">06/11/2026</td><td class="dt-status">Entrega Realizada</td><td class="dt-data-entrega">06/11/2026</td></tr></table>`);
assert.strictEqual(br2.entregue, true);
assert.strictEqual(br2.dataEntrega, '2026-11-06');
assert.strictEqual(lerBraspress('<p>Nenhuma encomenda foi encontrada!</p>'), null);

const item = (d, h, t) => `<div class="occurrence-item"><div><i></i><span>${d}</span><i></i><span>${h}</span></div><div><i></i><span>${t}</span></div></div><hr>`;
const tg = lerTgex(`<div><p>Entrega realizada</p><p>Prev. Entrega</p><p>05/11/2026</p></div><section class="occurrences"><h2>Ocorrências: NF 16781</h2><div>${item('06/11/2026', '08:23', 'Saida para entrega')}${item('06/11/2026', '07:45', 'Transferência Completada')}</div></section>`);
assert.deepStrictEqual(tg, { status: 'Saida para entrega', local: '', quando: '06/11/2026 08:23', previsao: '2026-11-05', entregue: false, dataEntrega: '' });
const tg2 = lerTgex(`<section class="occurrences"><div>${item('07/11/2026', '10:00', 'Entrega realizada')}${item('06/11/2026', '08:23', 'Saida para entrega')}</div></section>`);
assert.strictEqual(tg2.entregue, true);
assert.strictEqual(tg2.dataEntrega, '2026-11-07');
assert.strictEqual(lerTgex('<section class="occurrences"></section>'), null);

console.log('Leitura das páginas: ok');
