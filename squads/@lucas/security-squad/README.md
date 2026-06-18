# Security Squad

Squad de segurança ofensiva e defensiva para ambientes **web, desktop e mobile**. Cobre desde análise estática de código até simulação de ataques reais, com conformidade regulatória (LGPD, GDPR, SOC2) e resposta a incidentes.

## Agentes

| Agente | Responsabilidade |
|--------|-----------------|
| Security Chief | Orquestrador — diagnostica, roteia e entrega o relatório final |
| Threat Modeler | Modelagem de ameaças — STRIDE, MITRE ATT&CK, DREAD |
| Secure Code Reviewer | Revisão de código — OWASP Top 10, CWE Top 25 |
| Compliance Auditor | Conformidade — LGPD, GDPR, SOC2, ISO 27001, PCI-DSS |
| Database Security Analyst | Segurança de banco de dados — SQL/NoSQL, acesso, criptografia |
| Secrets & Credentials Analyst | Credenciais expostas — API keys, JWT, rotação |
| Supply Chain Analyst | Dependências — CVEs, ataques de supply chain, CI/CD |
| API & SSL/TLS Analyst | APIs e transporte — OWASP API Top 10, TLS, CORS |
| Incident Responder | Detecção e resposta — NIST IR, regras SIEM, runbooks |
| Pentest / Red Team | Testes ofensivos — PTES, WSTG, MSTG, cadeias de ataque |

---

## Skills disponíveis

As skills abaixo ampliam significativamente a capacidade da squad. Sem elas, os agentes operam apenas com o conhecimento embutido nos prompts. **Com elas, os agentes consultam fontes externas em tempo real durante a execução.**

### `cve-lookup`
Consulta a base de dados OSV.dev e NVD para buscar CVEs de pacotes e versões específicas em tempo real.

- **Agentes beneficiados:** Supply Chain Analyst, API & SSL Analyst
- **Sem a skill:** análise de CVEs baseada apenas em conhecimento interno (pode estar desatualizado)
- **Com a skill:** CVEs verificados na execução, com CVSS e status de patch atual

### `owasp-checker`
Acessa a OWASP Cheat Sheet Series e OWASP Testing Guide via web para checagens atualizadas.

- **Agentes beneficiados:** Secure Code Reviewer, API & SSL Analyst, Pentest / Red Team
- **Sem a skill:** checklists OWASP embutidos na versão de treinamento do agente
- **Com a skill:** checklists e guias na versão mais recente publicada pela OWASP

### `ssl-analyzer`
Instrui o agente a consultar critérios do SSL Labs e Mozilla SSL Configuration Generator para validar configurações TLS.

- **Agentes beneficiados:** API & SSL Analyst
- **Sem a skill:** análise de TLS baseada em conhecimento interno
- **Com a skill:** comparação com perfis Mozilla (Modern/Intermediate/Old) e grade SSL Labs simulada

### `cvss-scorer`
Guia estruturado para cálculo preciso de CVSS v3.1 com vetor completo e justificativa de cada métrica.

- **Agentes beneficiados:** Security Chief, Pentest / Red Team, Threat Modeler
- **Sem a skill:** scoring estimado pelo agente
- **Com a skill:** vetor CVSS calculado métrica a métrica com justificativa auditável

### `threat-intel`
Acessa o MITRE ATT&CK Navigator e técnicas recentes via web_fetch para enriquecer modelos de ameaça.

- **Agentes beneficiados:** Threat Modeler, Incident Responder
- **Sem a skill:** mapeamento ATT&CK baseado em conhecimento interno
- **Com a skill:** técnicas verificadas na base MITRE com sub-técnicas e mitigações atuais

---

## Instalação das skills

### Pré-requisito

A pasta `skills/` deve existir na raiz do projeto. Verifique ou crie:

```
skills/
├── cve-lookup/
├── owasp-checker/
├── ssl-analyzer/
├── cvss-scorer/
└── threat-intel/
```

### Passo 1 — Criar o arquivo SKILL.md de cada skill

Cada pasta de skill precisa de um `SKILL.md` com o seguinte formato:

```yaml
---
name: "cve-lookup"
description: "Consulta CVEs em tempo real via OSV.dev e NVD para pacotes e versões específicas"
type: prompt
version: "1.0.0"
categories: [security, vulnerability, supply-chain]
---

# Instruções da skill cve-lookup

Quando solicitado a verificar CVEs de um pacote:
1. Use web_fetch para consultar https://api.osv.dev/v1/query
2. Body: {"package": {"name": "[package]", "ecosystem": "[npm|PyPI|Maven]"}}
3. Retorne: CVE ID, CVSS, versões afetadas, versão com fix
```

Repita o processo para cada skill listada acima, adaptando o `name`, `description` e instruções.

### Passo 2 — Registrar as skills no `squad.yaml`

Abra `squad.yaml` e adicione as skills instaladas à seção `skills:`:

```yaml
skills:
  - web_search
  - web_fetch
  - cve-lookup
  - owasp-checker
  - ssl-analyzer
  - cvss-scorer
  - threat-intel
```

### Passo 3 — Referenciar nos agentes

Abra cada `.agent.md` que deve usar a skill e adicione ao frontmatter:

```yaml
---
skills:
  - web_fetch
  - cve-lookup      # ← adicionar aqui
---
```

Mapeamento recomendado:

| Skill | Agentes para atualizar |
|-------|----------------------|
| `cve-lookup` | `supply-chain-analyst.agent.md`, `api-security-analyst.agent.md` |
| `owasp-checker` | `secure-code-reviewer.agent.md`, `api-security-analyst.agent.md`, `pentest-red-team.agent.md` |
| `ssl-analyzer` | `api-security-analyst.agent.md` |
| `cvss-scorer` | `security-chief.agent.md`, `pentest-red-team.agent.md`, `threat-modeler.agent.md` |
| `threat-intel` | `threat-modeler.agent.md`, `incident-responder.agent.md` |

---

## Capacidade sem vs. com skills

| Capacidade | Sem skills | Com skills |
|-----------|-----------|-----------|
| Análise de CVEs | Conhecimento do modelo (pode estar desatualizado) | Dados em tempo real do OSV.dev + NVD |
| Checklists OWASP | Versão embutida no treinamento | Versão atual da documentação OWASP |
| Análise TLS | Baseada em conhecimento interno | Comparação com perfis Mozilla atuais |
| CVSS scoring | Estimado | Calculado com vetor completo e auditável |
| MITRE ATT&CK | Técnicas conhecidas até o treinamento | Técnicas verificadas na base MITRE atual |

---

*Security Squad v1.0.0 — ExpxAgents @community*
