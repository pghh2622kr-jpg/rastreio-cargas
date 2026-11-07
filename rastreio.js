// Rastreio diário das cargas em trânsito (Mediton e AGKVIDA), sem precisar do computador.
// Lê as cargas "Em trânsito" (etapa 3) no Firestore, consulta as transportadoras e grava o resultado.
// Variáveis: FIREBASE_SA (JSON da chave de serviço), TESTE=1 para só consultar e não gravar nada.
const admin = require('firebase-admin');
const fs = require('fs');
const T = require('./transportadoras');

const TESTE = process.env.TESTE === '1';
const EMPRESAS = {
  cargas: { nome: 'Mediton', cnpj: '29614830000190' },
  cargas_agkvida: { nome: 'AGKVIDA', cnpj: '82225947000165' },
};

// Transportadoras que o Rodrigo decidiu não consultar
const PULAR = /translovato|s[aã]o miguel/i;
// Sem consulta automática possível (login ou CAPTCHA): ficam para conferir no portal
const SEM_AUTOMATICO = [
  [/multi/i, 'Multiexp/MultiSCV: o portal exige login'],
  [/jad\s*log/i, 'Jadlog: o site exige CAPTCHA'],
  [/correios/i, 'Correios: o site exige CAPTCHA'],
];

const so = t => String(t || '').replace(/\D/g, '');
const nfDe = x => String(x.nf || ((x.chave || '').length === 44 ? parseInt(x.chave.substr(25, 9), 10) : '') || '').replace(/\D/g, '').replace(/^0+/, '');
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // horário de Brasília

async function main() {
  const sa = JSON.parse(process.env.FIREBASE_SA || '{}');
  if (!sa.private_key) throw new Error('Falta a chave de serviço do Firebase (segredo FIREBASE_SA).');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();

  const cargas = [];
  for (const col of Object.keys(EMPRESAS)) {
    const s = await db.collection(col).where('etapa', '==', 3).get();
    s.forEach(d => cargas.push({ col, id: d.id, x: d.data() }));
  }

  const entregues = [], emTransito = [], semResultado = [], pendentes = {};
  const anota = (c, nome, r) => {
    const base = { empresa: EMPRESAS[c.col].nome, orgao: c.x.orgao || '', cidade: [c.x.cidade, c.x.uf].filter(Boolean).join('/'), nf: nfDe(c.x), transp: nome, prazo: c.x.prazo || '' };
    if (!r) semResultado.push(base);
    else if (r.entregue) entregues.push({ ...base, data: r.dataEntrega || hoje() });
    else emTransito.push({ ...base, ...r });
  };
  const pendente = (nome, motivo) => { pendentes[nome] = pendentes[nome] || { motivo, n: 0 }; pendentes[nome].n++; };

  // Separa por forma de consulta
  const porSSW = {};
  const fila = [];
  for (const c of cargas) {
    const tr = String(c.x.transportadora || '').trim(), nf = nfDe(c.x);
    if (PULAR.test(tr)) continue;
    const sem = SEM_AUTOMATICO.find(([re]) => re.test(tr));
    if (sem) { pendente(tr, sem[1]); continue; }
    if (!nf) { pendente(tr || '(sem transportadora)', 'carga sem número de NF'); continue; }
    if (/braspress/i.test(tr)) fila.push({ c, tipo: 'braspress', nome: 'Braspress' });
    else if (/tgex|gritsch/i.test(tr)) {
      if (!so(c.x.cnpjCliente)) { pendente('TGEX', 'falta o CNPJ do cliente no cadastro da carga'); continue; }
      fila.push({ c, tipo: 'tgex', nome: 'TGEX' });
    } else if (!tr) pendente('(sem transportadora)', 'carga sem transportadora');
    else {
      const k = c.col; (porSSW[k] = porSSW[k] || []).push(c);
    }
  }

  const resultados = []; // { c, nome, r }
  for (const [col, lista] of Object.entries(porSSW)) {
    try {
      const r = await T.ssw(EMPRESAS[col].cnpj, [...new Set(lista.map(c => nfDe(c.x)))]);
      lista.forEach(c => resultados.push({ c, nome: String(c.x.transportadora).trim(), r: r[nfDe(c.x)] || null }));
    } catch (e) {
      lista.forEach(c => pendente(String(c.x.transportadora).trim(), 'erro ao consultar o SSW: ' + e.message));
    }
  }
  for (const it of fila) {
    try {
      const r = it.tipo === 'braspress'
        ? await T.braspress(EMPRESAS[it.c.col].cnpj, nfDe(it.c.x))
        : await T.tgex(so(it.c.x.cnpjCliente), nfDe(it.c.x));
      resultados.push({ c: it.c, nome: it.nome, r });
    } catch (e) {
      pendente(it.nome, 'erro ao consultar o site: ' + e.message);
    }
  }

  // Grava
  for (const { c, nome, r } of resultados) {
    anota(c, nome, r);
    if (!r || TESTE) continue;
    const ref = db.collection(c.col).doc(c.id);
    const agora = new Date().toISOString();
    const upd = {
      rastreioInfo: { status: r.status, local: r.local || '', quando: r.quando || '', previsao: r.previsao || '', fonte: nome + ' (automático)', consultado: agora },
    };
    if (r.entregue) {
      const d = r.dataEntrega || hoje();
      Object.assign(upd, {
        etapa: 4, 'datas.e4': d, fim: d, entregueEm: Date.now(), alteradoPor: 'Rastreio automático', alteradoEm: agora,
        hist: admin.firestore.FieldValue.arrayUnion({ q: 'Rastreio automático', e: agora, t: `Etapa: Em trânsito → Entregue (confirmado no site da ${nome})` }),
      });
    }
    await ref.update(upd);
  }

  // Resumo
  const L = [];
  const dt = d => (d || '').split('-').reverse().join('/');
  L.push(`# Rastreio das cargas – ${dt(hoje())}${TESTE ? ' (TESTE: nada foi gravado)' : ''}`);
  L.push(`\n## Entregues (${entregues.length})${entregues.length ? ' – e-mail de "entregue" ao cliente não foi enviado; mande pelo painel' : ''}`);
  entregues.forEach(e => L.push(`- ${e.empresa} · ${e.orgao} (${e.cidade}) · NF ${e.nf} · ${e.transp} · entregue em ${dt(e.data)}`));
  const atrasada = e => e.prazo && ((e.previsao && e.previsao > e.prazo) || e.prazo < hoje());
  const ord = [...emTransito].sort((a, b) => (atrasada(b) - atrasada(a)) || a.transp.localeCompare(b.transp));
  L.push(`\n## Em trânsito (${emTransito.length})`);
  ord.forEach(e => L.push(`- ${atrasada(e) ? '⚠️ ' : ''}${e.transp} · ${e.empresa} · ${e.orgao} · NF ${e.nf} · ${e.status}${e.local ? ' · ' + e.local : ''}${e.quando ? ' · ' + e.quando : ''}${e.previsao ? ' · previsão ' + dt(e.previsao) : ''}${e.prazo ? ' · prazo do órgão ' + dt(e.prazo) : ''}`));
  if (semResultado.length) {
    L.push(`\n## Sem informação no site da transportadora (${semResultado.length})`);
    semResultado.forEach(e => L.push(`- ${e.transp} · ${e.empresa} · ${e.orgao} · NF ${e.nf}`));
  }
  const pk = Object.keys(pendentes);
  if (pk.length) {
    L.push('\n## Não consultadas automaticamente');
    pk.forEach(k => L.push(`- ${k}: ${pendentes[k].n} carga(s) – ${pendentes[k].motivo}`));
  }
  const porEmp = n => resultados.filter(x => EMPRESAS[x.c.col].nome === n).length;
  L.push(`\nConsultadas: ${porEmp('Mediton')} da Mediton e ${porEmp('AGKVIDA')} da AGKVIDA.`);
  const texto = L.join('\n');
  console.log(texto);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texto + '\n');
  fs.writeFileSync('resumo.md', texto + '\n');
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
