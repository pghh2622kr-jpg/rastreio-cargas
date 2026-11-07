// Consulta o rastreio nos sites das transportadoras, sem navegador.
// Cada função devolve, por NF, { status, local, quando, previsao, entregue, dataEntrega } ou null se não achou.
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const espera = ms => new Promise(r => setTimeout(r, ms));
const limpa = t => String(t || '').replace(/\s+/g, ' ').trim();

// "06/11/2026" ou "06/11/26" -> "2026-11-06"
function iso(d) {
  const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return '';
  const a = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${a}-${m[2]}-${m[1]}`;
}

async function baixa(url, opcoes = {}) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await fetch(url, {
        ...opcoes,
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', ...(opcoes.headers || {}) },
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (tentativa === 3) throw e;
      await espera(3000 * tentativa);
    }
  }
}

const ENTREGUE = /entrega realizada|mercadoria entregue|\bentregue\b/i;
const NAO_E_ENTREGA = /saiu para entrega|sa[ií]da para entrega|em rota|pendente|devolu|recus|tentativa/i;

// ---------- SSW (Rodonaves e outras): uma consulta para várias NFs do mesmo remetente ----------
function lerSSW(html) {
  const $ = cheerio.load(html);
  const res = {};
  $('tr').each((_, tr) => {
    const td = $(tr).children('td');
    if (td.length < 3) return;
    const nfTxt = limpa(td.eq(0).text());
    const nfs = nfTxt.match(/\d+/g);
    if (!nfs) return;
    const nf = String(parseInt(nfs[nfs.length - 1], 10));
    const situ = limpa(td.eq(2).text());
    if (!situ || /informa[cç][aã]o n[aã]o dispon/i.test(situ)) return;
    const meio = limpa(td.eq(1).text());
    const dm = meio.match(/(\d{2}\/\d{2}\/\d{2,4})(?:\s+(\d{2}:\d{2}))?/);
    const local = limpa(dm ? meio.slice(0, dm.index) : meio);
    const quando = dm ? (dm[1] + (dm[2] ? ' ' + dm[2] : '')) : '';
    const status = limpa(situ.split('(')[0]).slice(0, 120) || situ.slice(0, 120);
    const pv = situ.match(/previs[aã]o de entrega:?\s*(\d{2}\/\d{2}\/\d{2,4})/i);
    const entregue = ENTREGUE.test(status) && !NAO_E_ENTREGA.test(status);
    res[nf] = { status, local, quando, previsao: pv ? iso(pv[1]) : '', entregue, dataEntrega: entregue ? iso(quando) : '' };
  });
  return res;
}

async function ssw(cnpjRemetente, nfs) {
  const res = {};
  for (let i = 0; i < nfs.length; i += 25) {
    const lote = nfs.slice(i, i + 25);
    const corpo = new URLSearchParams({ cnpj: cnpjRemetente, NR: lote.join('\r\n'), chave: '' });
    const html = await baixa('https://ssw.inf.br/2/resultSSW', {
      method: 'POST', body: corpo,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://ssw.inf.br/2/rastreamento' },
    });
    Object.assign(res, lerSSW(html));
    await espera(2000);
  }
  return res;
}

// ---------- Braspress: uma consulta por NF ----------
function lerBraspress(html) {
  const $ = cheerio.load(html);
  const pega = c => limpa($('td.' + c).first().text());
  if (!pega('dt-nf') && !pega('dt-status')) return null;
  const status = pega('dt-status');
  const dataEnt = pega('dt-data-entrega');
  // Linha do tempo detalhada (vem repetida na página: fica com a primeira ocorrência de cada evento)
  const vistos = new Set(), eventos = [];
  const infos = $('.vertical-time-line-info'), datas = $('.vertical-time-line-date');
  infos.each((i, el) => {
    const t = limpa($(el).text()), d = limpa(datas.eq(i).text());
    const k = t + '|' + d;
    if (t && !vistos.has(k)) { vistos.add(k); eventos.push({ t, d }); }
  });
  const comData = eventos.filter(e => /\d{2}\/\d{2}\/\d{4}/.test(e.d));
  const ult = comData[comData.length - 1];
  const ultTexto = eventos.length ? eventos[eventos.length - 1].t : '';
  const filial = [...eventos].reverse().map(e => (e.t.match(/FILIAL (?:DE )?(?:ORIGEM|DESTINO) - (.+)$/i) || [])[1]).find(Boolean) || '';
  const entregue = !!dataEnt || (ENTREGUE.test(status) && !NAO_E_ENTREGA.test(status));
  return {
    status: (status + (ultTexto && !ENTREGUE.test(status) && ultTexto.toLowerCase() !== status.toLowerCase() ? ' – ' + ultTexto : '')).slice(0, 120),
    local: filial,
    quando: ult ? ult.d : '',
    previsao: iso(pega('dt-previsao-entrega')),
    entregue,
    dataEntrega: entregue ? (iso(dataEnt) || iso(ult && ult.d)) : '',
  };
}

async function braspress(cnpjRemetente, nf) {
  const url = 'https://blue.braspress.com/site/w/tracking/find?' + new URLSearchParams({ cpfCnpj: cnpjRemetente, pedidoNf: nf });
  const html = await baixa(url);
  await espera(1500);
  return lerBraspress(html);
}

// ---------- TGEX / Grupo Gritsch: uma consulta por NF, pelo CNPJ do destinatário ----------
function lerTgex(html) {
  const $ = cheerio.load(html);
  const itens = $('section.occurrences .occurrence-item');
  if (!itens.length) return null;
  const ev = itens.map((_, it) => {
    const sp = $(it).find('span').map((__, s) => limpa($(s).text())).get();
    return { d: sp[0] || '', h: sp[1] || '', t: sp[2] || sp[sp.length - 1] || '' };
  }).get();
  const ult = ev[0]; // a lista vem da mais nova para a mais antiga
  let previsao = '';
  $('p, span').each((_, el) => {
    if (!previsao && /Prev\. Entrega/i.test($(el).text()) && $(el).children().length === 0) previsao = iso($(el).next().text());
  });
  const ent = ev.find(e => ENTREGUE.test(e.t) && !NAO_E_ENTREGA.test(e.t));
  return {
    status: ult.t.slice(0, 120),
    local: '',
    quando: limpa(ult.d + ' ' + ult.h),
    previsao,
    entregue: !!ent,
    dataEntrega: ent ? iso(ent.d) : '',
  };
}

async function tgex(cnpjDestinatario, nf) {
  const url = 'https://gritsch.eslcloud.com.br/recipient_tracking?' + new URLSearchParams({
    utf8: '✓', document_from: 'brazil', document: cnpjDestinatario, number: nf, number_type: 'invoice_number',
  });
  const html = await baixa(url);
  await espera(1500);
  return lerTgex(html);
}

module.exports = { ssw, braspress, tgex, lerSSW, lerBraspress, lerTgex, iso };
