#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Revisar_peticao.py — Revisor de petições para o CRM Jurídico (Letícia Barros).

O QUE FAZ
=========
Recebe uma petição (PDF, DOCX ou texto) e devolve uma revisão em duas camadas:

  1. CHECAGENS ESTRUTURAIS (por regra, offline e grátis)
     Verifica se a peça tem os elementos obrigatórios de uma petição:
     endereçamento, qualificação das partes, dos fatos, do direito,
     dos pedidos, valor da causa, fecho, data e assinatura/OAB.

  2. ANÁLISE DE MÉRITO POR IA (opcional)
     Usa os MESMOS provedores do CRM (src/services/aiAssistant.ts):
       - Groq  → análise/triagem rápida (preferido para revisão)
       - Gemini → fallback
     Reaproveita as chaves GROQ_API_KEY / GEMINI_API_KEY já configuradas.
     Sem chave, roda só as checagens estruturais (o fluxo continua válido).

A saída é um JSON estruturado — feito para o Node chamar como subprocesso:

    python Revisar_peticao.py peticao.pdf --json

USO (CLI)
=========
    python Revisar_peticao.py arquivo.pdf              # relatório legível
    python Revisar_peticao.py arquivo.docx --json      # JSON (para o CRM)
    python Revisar_peticao.py --texto "..." --json     # texto direto
    python Revisar_peticao.py arquivo.pdf --sem-ia      # só checagens de regra
    cat peticao.txt | python Revisar_peticao.py --json  # via stdin

USO (import)
============
    from Revisar_peticao import revisar
    resultado = revisar(texto="...", usar_ia=True)

DEPENDÊNCIAS OPCIONAIS (só p/ extrair texto de arquivos)
    pip install pdfplumber python-docx
    (o restante — HTTP, regex, JSON — é biblioteca padrão do Python)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

# ──────────────────────────────────────────────────────────────────────────
#  Config / .env
# ──────────────────────────────────────────────────────────────────────────

# Carrega variáveis do .env do backend, se existir, sem depender de libs
# externas. Prioridade: variável de ambiente já definida > .env do projeto.
def _carregar_env() -> None:
    candidatos = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
        os.path.join(os.getcwd(), ".env"),
    ]
    for caminho in candidatos:
        if not os.path.isfile(caminho):
            continue
        try:
            with open(caminho, "r", encoding="utf-8") as fh:
                for linha in fh:
                    linha = linha.strip()
                    if not linha or linha.startswith("#") or "=" not in linha:
                        continue
                    chave, _, valor = linha.partition("=")
                    chave = chave.strip()
                    valor = valor.strip().strip('"').strip("'")
                    if chave and chave not in os.environ:
                        os.environ[chave] = valor
        except OSError:
            pass
        break


_carregar_env()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

HTTP_TIMEOUT = int(os.environ.get("REVISAO_TIMEOUT", "60"))


# ──────────────────────────────────────────────────────────────────────────
#  Extração de texto (PDF / DOCX / TXT)
# ──────────────────────────────────────────────────────────────────────────

def extrair_texto(caminho: str) -> str:
    """Extrai o texto de um arquivo conforme a extensão."""
    ext = os.path.splitext(caminho)[1].lower()
    if ext == ".pdf":
        return _extrair_pdf(caminho)
    if ext in (".docx",):
        return _extrair_docx(caminho)
    if ext in (".txt", ".md", ""):
        with open(caminho, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    raise ValueError(
        f"Extensão não suportada: '{ext}'. Use .pdf, .docx ou .txt "
        "(ou passe o conteúdo com --texto)."
    )


def _extrair_pdf(caminho: str) -> str:
    # Tenta pdfplumber (melhor layout); cai para pypdf/PyPDF2 se não houver.
    try:
        import pdfplumber  # type: ignore

        partes: List[str] = []
        with pdfplumber.open(caminho) as pdf:
            for pagina in pdf.pages:
                partes.append(pagina.extract_text() or "")
        return "\n".join(partes)
    except ImportError:
        pass

    try:
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError:
            from PyPDF2 import PdfReader  # type: ignore
        leitor = PdfReader(caminho)
        return "\n".join((p.extract_text() or "") for p in leitor.pages)
    except ImportError as e:
        raise RuntimeError(
            "Para ler PDF instale: pip install pdfplumber  (ou pypdf)."
        ) from e


def _extrair_docx(caminho: str) -> str:
    try:
        import docx  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "Para ler DOCX instale: pip install python-docx."
        ) from e
    documento = docx.Document(caminho)
    return "\n".join(p.text for p in documento.paragraphs)


# ──────────────────────────────────────────────────────────────────────────
#  Checagens estruturais (por regra — offline, grátis)
# ──────────────────────────────────────────────────────────────────────────

def _normalizar(texto: str) -> str:
    """minúsculas + sem acento — facilita casar com regex."""
    t = unicodedata.normalize("NFKD", texto)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return t.lower()


def checagens_estruturais(texto: str) -> List[Dict[str, Any]]:
    """
    Verifica os elementos obrigatórios da petição (CPC art. 319/320 e boas
    práticas). Retorna uma lista de itens: {item, ok, gravidade, detalhe}.
    """
    n = _normalizar(texto)
    achados: List[Dict[str, Any]] = []

    def add(item: str, ok: bool, gravidade: str, detalhe: str) -> None:
        achados.append(
            {"item": item, "ok": ok, "gravidade": gravidade, "detalhe": detalhe}
        )

    # Endereçamento (juízo / vara / comarca)
    enderecamento = bool(
        re.search(r"\b(exmo|excelentissimo|meritissimo|juizo|vara|comarca|tribunal|turma)\b", n)
    )
    add("Endereçamento", enderecamento, "alta",
        "Cabeçalho ao juízo/vara competente." if enderecamento
        else "Não localizado o endereçamento ao juízo (ex.: 'Exmo. Sr. Dr. Juiz...').")

    # Qualificação das partes (CPF/CNPJ, nacionalidade, endereço)
    tem_doc = bool(re.search(r"\bcpf\b|\bcnpj\b", n))
    tem_qualif = bool(re.search(r"\b(brasileir[oa]|nacionalidade|estado civil|residente|domiciliad)", n))
    qualificacao = tem_doc or tem_qualif
    add("Qualificação das partes", qualificacao, "alta",
        "Dados de qualificação presentes (CPF/CNPJ, estado civil, endereço)." if qualificacao
        else "Faltam dados de qualificação das partes (CPF/CNPJ, nacionalidade, endereço) — CPC art. 319, II.")

    # Dos fatos
    dos_fatos = bool(re.search(r"\bdos fatos\b|\bd[oa]s? fato", n))
    add("Dos fatos", dos_fatos, "media",
        "Seção de fatos identificada." if dos_fatos
        else "Não há seção de 'Dos Fatos' claramente delimitada.")

    # Do direito / fundamentação jurídica
    do_direito = bool(re.search(r"\bdo direito\b|\bfundament", n))
    add("Do direito / fundamentação", do_direito, "media",
        "Fundamentação jurídica identificada." if do_direito
        else "Não há seção 'Do Direito'/fundamentação jurídica clara.")

    # Menção a base legal (artigos de lei)
    base_legal = bool(re.search(r"\bart(?:igo)?s?\.?\s*\d+|\blei\s*n", n))
    add("Base legal citada", base_legal, "media",
        "Há citação de dispositivos legais." if base_legal
        else "Nenhum artigo de lei ou norma citado — reforçar a fundamentação.")

    # Dos pedidos
    dos_pedidos = bool(re.search(r"\bdos pedidos\b|\brequer\b|\bpede\b|\bpostula\b|\bpugna\b", n))
    add("Dos pedidos", dos_pedidos, "alta",
        "Pedido(s) identificado(s)." if dos_pedidos
        else "Não localizado o rol de pedidos ('Requer...', 'Dos Pedidos').")

    # Valor da causa
    valor_causa = bool(re.search(r"valor da causa|d[aoe] causa.*r\$|\br\$\s*[\d\.]+", n))
    add("Valor da causa", valor_causa, "alta",
        "Valor da causa indicado." if valor_causa
        else "Valor da causa não localizado — obrigatório (CPC art. 319, V / 291).")

    # Requerimento de provas
    provas = bool(re.search(r"\bprotesta\b.*prov|\bprovar\b|meios de prova|\bprovas admit", n))
    add("Requerimento de provas", provas, "baixa",
        "Protesto/menção a provas presente." if provas
        else "Não há protesto por provas (documental, testemunhal, pericial).")

    # Fecho + local/data
    fecho = bool(re.search(r"termos em que|nestes termos|pede deferimento|p\.?\s*deferimento", n))
    data = bool(re.search(r"\b\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}\b|\b\d{2}/\d{2}/\d{4}\b", n))
    add("Fecho e data", fecho and data, "media",
        "Fecho ('Nestes termos...') e data presentes." if (fecho and data)
        else "Verificar fecho ('Nestes termos, pede deferimento') e local/data.")

    # Assinatura / OAB
    assinatura = bool(re.search(r"\boab\b|advogad", n))
    add("Assinatura / OAB", assinatura, "alta",
        "Assinatura do advogado / OAB presente." if assinatura
        else "Não localizada assinatura do advogado com número da OAB.")

    return achados


# ──────────────────────────────────────────────────────────────────────────
#  Análise por IA (Groq → fallback Gemini) — mesmo padrão do aiAssistant.ts
# ──────────────────────────────────────────────────────────────────────────

PROMPT_REVISAO = """Você é um advogado brasileiro sênior revisando a petição abaixo antes do protocolo.
Faça uma REVISÃO CRÍTICA, técnica e objetiva. NÃO reescreva a peça — aponte o que precisa melhorar.

Avalie e responda em tópicos curtos:
1. ADEQUAÇÃO FORMAL: endereçamento, qualificação das partes, valor da causa, pedidos, fecho, assinatura/OAB.
2. FUNDAMENTAÇÃO: o direito invocado sustenta os pedidos? Faltam dispositivos legais ou jurisprudência?
3. COERÊNCIA FATOS ↔ PEDIDOS: cada pedido decorre dos fatos narrados? Há pedido sem causa de pedir?
4. RISCOS: preliminares que a parte contrária pode arguir (inépcia, prescrição, ilegitimidade, etc.).
5. LINGUAGEM: clareza, técnica e correção.
6. NOTA GERAL (0 a 10) e as 3 correções mais importantes, em ordem de prioridade.

Seja específico e cite trechos quando útil. Se algo estiver correto, diga que está adequado.

=== PETIÇÃO ===
{peticao}
=== FIM ==="""


def _http_post_json(url: str, payload: dict, headers: dict) -> dict:
    dados = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=dados, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _chamar_groq(prompt: str) -> Dict[str, Any]:
    if not GROQ_API_KEY:
        return {"ok": False, "message": "sem_groq"}
    try:
        d = _http_post_json(
            "https://api.groq.com/openai/v1/chat/completions",
            {"model": GROQ_MODEL, "messages": [{"role": "user", "content": prompt}]},
            {"Content-Type": "application/json", "Authorization": f"Bearer {GROQ_API_KEY}"},
        )
        texto = (d.get("choices") or [{}])[0].get("message", {}).get("content", "")
        return {"ok": True, "text": texto, "provider": "groq"}
    except urllib.error.HTTPError as e:
        try:
            corpo = json.loads(e.read().decode("utf-8"))
            msg = corpo.get("error", {}).get("message", str(e))
        except Exception:
            msg = str(e)
        return {"ok": False, "message": f"Erro Groq: {msg}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"Erro Groq: {e}"}


def _chamar_gemini(prompt: str) -> Dict[str, Any]:
    if not GEMINI_API_KEY:
        return {"ok": False, "message": "sem_gemini"}
    try:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        )
        d = _http_post_json(
            url,
            {"contents": [{"parts": [{"text": prompt}]}]},
            {"Content-Type": "application/json"},
        )
        partes = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        texto = "".join(p.get("text", "") for p in partes)
        return {"ok": True, "text": texto, "provider": "gemini"}
    except urllib.error.HTTPError as e:
        try:
            corpo = json.loads(e.read().decode("utf-8"))
            msg = corpo.get("error", {}).get("message", str(e))
        except Exception:
            msg = str(e)
        return {"ok": False, "message": f"Erro Gemini: {msg}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"Erro Gemini: {e}"}


def analise_ia(texto: str) -> Dict[str, Any]:
    """
    Revisão de mérito por IA. Prefere Groq (análise), cai no Gemini.
    Sem nenhuma chave → {ok: False, message: 'sem_chave'}.
    """
    prompt = PROMPT_REVISAO.format(peticao=texto[:24000])
    ultimo = "sem_chave"
    for chamada in (_chamar_groq, _chamar_gemini):
        r = chamada(prompt)
        if r.get("ok"):
            return r
        ultimo = r.get("message", ultimo)
    return {"ok": False, "message": ultimo}


# ──────────────────────────────────────────────────────────────────────────
#  Orquestração
# ──────────────────────────────────────────────────────────────────────────

def revisar(
    texto: Optional[str] = None,
    caminho: Optional[str] = None,
    usar_ia: bool = True,
) -> Dict[str, Any]:
    """
    Executa a revisão completa e devolve um dicionário estruturado.

    Passe `texto` (conteúdo direto) OU `caminho` (arquivo pdf/docx/txt).
    """
    if not texto:
        if not caminho:
            raise ValueError("Informe 'texto' ou 'caminho'.")
        texto = extrair_texto(caminho)

    texto = (texto or "").strip()
    if not texto:
        return {"ok": False, "message": "Documento vazio ou sem texto extraível."}

    checagens = checagens_estruturais(texto)
    total = len(checagens)
    aprovados = sum(1 for c in checagens if c["ok"])
    faltas_altas = [c for c in checagens if not c["ok"] and c["gravidade"] == "alta"]

    resultado: Dict[str, Any] = {
        "ok": True,
        "resumo": {
            "itens_verificados": total,
            "itens_ok": aprovados,
            "percentual_estrutural": round(aprovados / total * 100) if total else 0,
            "pendencias_criticas": len(faltas_altas),
            "caracteres": len(texto),
        },
        "checagens_estruturais": checagens,
        "analise_ia": None,
        "ia_disponivel": bool(GROQ_API_KEY or GEMINI_API_KEY),
    }

    if usar_ia and resultado["ia_disponivel"]:
        ia = analise_ia(texto)
        if ia.get("ok"):
            resultado["analise_ia"] = {
                "provider": ia.get("provider"),
                "texto": ia.get("text", "").strip(),
            }
        else:
            resultado["analise_ia"] = {"erro": ia.get("message")}

    return resultado


# ──────────────────────────────────────────────────────────────────────────
#  Relatório legível (quando não é --json)
# ──────────────────────────────────────────────────────────────────────────

def _imprimir_relatorio(r: Dict[str, Any]) -> None:
    if not r.get("ok"):
        print(f"[ERRO] {r.get('message')}")
        return

    resumo = r["resumo"]
    print("=" * 60)
    print("  REVISÃO DE PETIÇÃO")
    print("=" * 60)
    print(
        f"Estrutura: {resumo['itens_ok']}/{resumo['itens_verificados']} itens OK "
        f"({resumo['percentual_estrutural']}%)  |  "
        f"Pendências críticas: {resumo['pendencias_criticas']}"
    )
    print("-" * 60)
    for c in r["checagens_estruturais"]:
        marca = "OK " if c["ok"] else "!! "
        grav = "" if c["ok"] else f" [{c['gravidade'].upper()}]"
        print(f"  {marca}{c['item']}{grav}")
        if not c["ok"]:
            print(f"       → {c['detalhe']}")
    print("-" * 60)

    ia = r.get("analise_ia")
    if ia and ia.get("texto"):
        print(f"ANÁLISE DE MÉRITO (IA · {ia.get('provider')}):\n")
        print(ia["texto"])
    elif ia and ia.get("erro"):
        print(f"[IA indisponível: {ia['erro']}]")
    elif not r.get("ia_disponivel"):
        print("[IA não configurada — rodou só as checagens estruturais.]")
    print("=" * 60)


# ──────────────────────────────────────────────────────────────────────────
#  CLI
# ──────────────────────────────────────────────────────────────────────────

def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Revisor de petições do CRM Jurídico (checagens + IA)."
    )
    parser.add_argument("arquivo", nargs="?", help="Caminho do arquivo (.pdf/.docx/.txt).")
    parser.add_argument("--texto", help="Conteúdo da petição em texto direto.")
    parser.add_argument("--json", action="store_true", help="Saída em JSON (para o CRM).")
    parser.add_argument("--sem-ia", action="store_true", help="Só checagens estruturais.")
    args = parser.parse_args(argv)

    texto = args.texto
    if not texto and not args.arquivo and not sys.stdin.isatty():
        texto = sys.stdin.read()  # permite: cat peticao.txt | python Revisar_peticao.py

    try:
        resultado = revisar(
            texto=texto,
            caminho=args.arquivo,
            usar_ia=not args.sem_ia,
        )
    except Exception as e:  # noqa: BLE001
        resultado = {"ok": False, "message": str(e)}

    if args.json:
        print(json.dumps(resultado, ensure_ascii=False, indent=2))
    else:
        _imprimir_relatorio(resultado)

    return 0 if resultado.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
