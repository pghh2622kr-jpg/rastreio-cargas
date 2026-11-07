# Rastreio automático das cargas

Roda sozinho no GitHub, todo dia por volta de 12:07 (Brasília), sem precisar de computador ligado.
Lê as cargas "Em trânsito" da Mediton e da AGKVIDA no painel, consulta as transportadoras,
grava em cada carga o último status, local, data e previsão, e marca como entregues as que já foram.

## O que é consultado
- **Braspress:** pelo CNPJ do remetente e a NF.
- **TGEX / Grupo Gritsch:** pelo CNPJ do cliente (destinatário) e a NF. Sem CNPJ do cliente na carga, ela fica de fora.
- **Rodonaves e demais transportadoras que usam o SSW:** pelo CNPJ do remetente e as NFs, em lote.
- **Não consultadas:** Translovato e Expresso São Miguel (decisão do Rodrigo); Multiexp/MultiSCV (portal com login);
  Jadlog e Correios (sites com CAPTCHA). Elas aparecem no resumo como "não consultadas automaticamente".

## Configuração (uma vez)
1. Crie no GitHub um repositório **privado** chamado `rastreio-cargas` e envie estes arquivos.
2. No Firebase: ⚙ Configurações do projeto → **Contas de serviço** → **Gerar nova chave privada**. Baixa um arquivo .json.
3. No repositório do GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
   Nome: `FIREBASE_SA`. Valor: todo o conteúdo do arquivo .json. Depois apague o .json do computador.
   Nunca envie essa chave por e-mail ou chat: ela dá acesso total ao banco.

## Testar e acompanhar
- **Actions → Rastreio diário das cargas → Run workflow.** Com "Só consultar" marcado, nada é gravado no painel.
- Cada execução mostra o resumo na própria página da execução (entregues, em trânsito, não consultadas).
- Se uma execução falhar, o GitHub manda e-mail para a conta dona do repositório.
- O GitHub pausa agendamentos de repositórios sem nenhuma atividade por 60 dias; se acontecer, é só clicar em "Enable workflow".
