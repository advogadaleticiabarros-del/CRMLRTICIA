// Exporta para o cofre Obsidian uma nota por cliente com caso encerrado (resultado), + PDFs anexados.
require('dotenv').config(); const fs=require('fs'); const path=require('path'); const {db}=require('./dist/config/database');
const OUT='/tmp/obs/Clientes'; fs.rmSync('/tmp/obs',{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
const brl=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dt=v=>v?new Date(v).toISOString().slice(0,10).split('-').reverse().join('/'):'—';
const safe=s=>String(s).replace(/[\\/:*?"<>|]/g,'').replace(/\s+/g,' ').trim().slice(0,90);
const RES={acordo:'Acordo',procedente:'Procedente',procedente_parcial:'Procedente em parte',improcedente:'Improcedente',renuncia:'Renúncia',desistencia:'Desistência'};
(async()=>{
 const [cases]=await db.query("SELECT c.*, cl.name cliente, cl.cpf_cnpj, cl.address, cl.phone, cl.email, cl.tipo FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE c.resultado IS NOT NULL OR EXISTS (SELECT 1 FROM documents d WHERE d.case_id=c.id AND d.data IS NOT NULL) ORDER BY cl.name");
 for(const c of cases){
  const nome=safe(c.cliente); const dir=path.join(OUT,nome); fs.mkdirSync(path.join(dir,'anexos'),{recursive:true});
  const [ag]=await db.query("SELECT * FROM agreements WHERE case_id=?",[c.id]);
  const [fin]=await db.query("SELECT description,valor,due_date,status,paid_at FROM financial_records WHERE agreement_id IN (SELECT id FROM agreements WHERE case_id=?) ORDER BY due_date",[c.id]);
  const [rep]=await db.query("SELECT tranche_label,valor_bruto,valor_honorarios,valor_liquido,status,data_repasse FROM agreement_client_payouts WHERE agreement_id IN (SELECT id FROM agreements WHERE case_id=?) ORDER BY id",[c.id]);
  const [partes]=await db.query("SELECT * FROM case_partes WHERE case_id=?",[c.id]).catch(()=>[[]]);
  const [docs]=await db.query("SELECT id,name,mime,data FROM documents WHERE case_id=? AND data IS NOT NULL",[c.id]);
  const links=[];
  for(const d of docs){ const ext=/pdf/.test(d.mime)?'.pdf':/png/.test(d.mime)?'.png':/jpe?g/.test(d.mime)?'.jpg':''; const fn=safe(d.name)+' #'+d.id+ext; fs.writeFileSync(path.join(dir,'anexos',fn),d.data); links.push(`- ![[anexos/${fn}]]`.replace('![[','[[')); }
  const pct=c.valor_causa&&c.valor_obtido!=null?` (${(c.valor_obtido/c.valor_causa*100).toFixed(0)}% do valor da causa)`:'';
  const md=`---
cliente: "${c.cliente}"
cpf_cnpj: "${c.cpf_cnpj||''}"
processo: "${c.case_number||''}"
resultado: ${c.resultado}
valor_causa: ${c.valor_causa||0}
valor_obtido: ${c.valor_obtido??''}
resultado_em: ${c.resultado_em?new Date(c.resultado_em).toISOString().slice(0,10):''}
polo_cliente: ${c.polo_cliente||'ativo'}
tags: [cliente, crm]
---
# ${c.cliente}

**${c.tipo==='PJ'?'CNPJ':'CPF'}:** ${c.cpf_cnpj||'—'} · **Endereço:** ${c.address||'—'}${c.phone?` · **Telefone:** ${c.phone}`:''}${c.email?` · **E-mail:** ${c.email}`:''}

## Processo ${c.case_number||''}
- **Caso:** ${c.title}${String(c.production_labels||"").includes("dativo")?" · **DATIVO**":""} · **Área:** ${c.legal_area||'—'} · **Cliente é:** ${c.polo_cliente==='passivo'?'ré (defesa)':'autora'}
- **Valor da causa:** ${brl(c.valor_causa)}
- **Resultado:** ${RES[c.resultado]||c.resultado} em ${dt(c.resultado_em)} — **obtido:** ${brl(c.valor_obtido)}${pct}
${partes.length?'\n### Partes\n'+partes.map(p=>`- **${p.papel}:** ${p.nome}${p.cpf_cnpj?' ('+p.cpf_cnpj+')':''}${p.advogado?' — adv. '+p.advogado+(p.advogado_oab?' OAB '+p.advogado_oab:''):''}`).join('\n')+'\n':''}
### Resumo
${String(c.description||'').trim()||'—'}
${ag.length?`
## Financeiro
${ag.map(a=>`- **Acordo** com ${a.opposing_party}: ${brl(a.total_agreement_value)} · honorários ${a.honorarium_percentage}% = ${brl(a.honorarium_value)} · sucumbência ${brl(a.sucumbencia_value)} · ${a.status}`).join('\n')}

| Lançamento | Valor | Vencimento | Situação |
|---|---|---|---|
${fin.map(f=>`| ${f.description} | ${brl(f.valor)} | ${dt(f.due_date)} | ${f.status}${f.paid_at?' em '+dt(f.paid_at):''} |`).join('\n')}

**Repasses à cliente**

| Parcela | Bruto | Honorários | Líquido | Situação |
|---|---|---|---|---|
${rep.map(r=>`| ${r.tranche_label} | ${brl(r.valor_bruto)} | ${brl(r.valor_honorarios)} | ${brl(r.valor_liquido)} | ${r.status}${r.data_repasse?' em '+dt(r.data_repasse):''} |`).join('\n')}
`:''}
## Documentos
${links.join('\n')||'—'}

*Gerado do CRM em ${new Date().toLocaleDateString('pt-BR')}. Fonte oficial: CRM.*
`;
  fs.writeFileSync(path.join(dir,nome+'.md'),md);
 }
 console.log('notas',cases.length); await db.end();
})().catch(e=>{console.error('ERRO',e.message);process.exit(1)});
