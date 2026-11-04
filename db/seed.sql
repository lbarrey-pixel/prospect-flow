-- Dados fictícios para demonstração. Domínios .example nunca resolvem na internet.
-- Uso: psql "$DATABASE_URL" -f db/seed.sql   (ou python -m scripts.aplicar_sql ../db/seed.sql)

insert into crm.operadores (email, nome, admin, caixa, bcc, regras) values
  ('ana@example.com',   'Ana',   true,  'ana@example.com',   'registro@example.com',
   '{"janela": {"dias": [1,2,3,4,5], "inicio": "08:00", "fim": "17:00"}}'),
  ('bruno@example.com', 'Bruno', false, 'bruno@example.com', 'registro@example.com',
   '{"teto_frios": 15, "janela": {"dias": [1,2,3,4,5], "inicio": "08:00", "fim": "17:00"}}'),
  ('carla@example.com', 'Carla', false, 'carla@example.com', 'registro@example.com', '{}')
on conflict (email) do nothing;

insert into crm.leads (dominio, empresa, dono_email, estagio_funil, teve_resposta, rodada_atual, ultimo_envio, observacao) values
  ('acme-industrial.example',  'Acme Industrial',       'ana@example.com',   'frio',      false, 0, null, null),
  ('borealis-metal.example',   'Borealis Metalúrgica',  'ana@example.com',   'aquecendo', false, 2, now() - interval '9 days', 'abriu o R1, não respondeu'),
  ('cobalto-energia.example',  'Cobalto Energia',       'ana@example.com',   'respondeu', true,  1, now() - interval '12 days', 'pediu catálogo'),
  ('delta-pecas.example',      'Delta Peças',           'bruno@example.com', 'frio',      false, 0, null, null),
  ('eletro-sigma.example',     'Eletro Sigma',          'bruno@example.com', 'qualificado', true, 2, now() - interval '20 days', 'quer cotação de 200 un.'),
  ('farol-logistica.example',  'Farol Logística',       'bruno@example.com', 'aquecendo', false, 1, now() - interval '8 days', null),
  ('granito-sul.example',      'Granito Sul',           'carla@example.com', 'frio',      false, 0, null, null),
  ('horizonte-plast.example',  'Horizonte Plásticos',   'carla@example.com', 'descartado', false, 3, now() - interval '70 days', 'sem demanda')
on conflict (dominio) do nothing;

insert into crm.contatos (lead_id, nome, email, cargo)
select l.id, c.nome, c.email, c.cargo
from crm.leads l
join (values
  ('acme-industrial.example',  'Marina Tavares', 'compras@acme-industrial.example',  'Compradora'),
  ('borealis-metal.example',   'Rui Campos',     'suprimentos@borealis-metal.example', 'Suprimentos'),
  ('cobalto-energia.example',  'Lúcia Prates',   'lucia@cobalto-energia.example',    'Gerente de compras'),
  ('delta-pecas.example',      'Otávio Brandão', 'compras@delta-pecas.example',      'Comprador'),
  ('eletro-sigma.example',     'Helena Veiga',   'helena@eletro-sigma.example',      'Coordenadora'),
  ('farol-logistica.example',  'Caio Mendes',    'compras@farol-logistica.example',  'Comprador'),
  ('granito-sul.example',      'Paula Rangel',   'paula@granito-sul.example',        'Compradora'),
  ('horizonte-plast.example',  'Sérgio Ávila',   'compras@horizonte-plast.example',  'Comprador')
) as c(dominio, nome, email, cargo) on c.dominio = l.dominio
on conflict do nothing;

insert into crm.interacoes (lead_id, email, nome, data_interacao, assunto, trecho, direcao, origem, classe, interesse)
select l.id, 'lucia@cobalto-energia.example', 'Lúcia Prates', now() - interval '10 days',
       'Re: Apresentação | Cobalto Energia', 'Boa tarde! Podem me mandar o catálogo atualizado com prazos?', 'recebido', 'api', 'humano', 'real'
from crm.leads l where l.dominio = 'cobalto-energia.example'
on conflict do nothing;

-- Diretrizes padrão (versão 1, ativa). O bot lê isto antes de cada tarefa.
insert into crm.diretrizes (operador, versao, status, conteudo, autor, autor_tipo)
values (null, 1, 'ativa', $dir$# Diretrizes do bot (padrão)

## Objetivo
Fazer o lead pedir um orçamento. O e-mail abre a conversa; quem fecha é o operador.

## O que nunca fazer
- Informar preço, prazo, condição comercial ou desconto.
- Prometer algo em nome do operador.
- Escrever para um contato marcado como inválido.

## Tom
- Curto, direto, em português. Uma pergunta por e-mail.
- R1 apresenta; R2 lembra o catálogo; R3 fecha o ciclo com educação.

## Quando não executar
- Lead respondeu e o operador ainda não tratou: adie e deixe um relato.
- Dúvida sobre regra comercial: pergunte ao operador (relato do tipo pergunta).
$dir$, 'seed', 'sistema')
on conflict do nothing;
