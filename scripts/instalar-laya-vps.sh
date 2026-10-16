#!/usr/bin/env bash
# Instala a Laya (modelo de decisão local, github.com/NandhaKishorM/laya) na VPS
# do CRM jurídico, do mesmo jeito que roda na VPS do CRM comercial:
# ambiente Python em /opt/laya, servidor laya-serve no PM2 com o nome "laya",
# ouvindo só em 127.0.0.1:8765. No fim, liga o CRM a ela (LAYA_URL no .env)
# e reinicia o crm-juridico. Pode rodar de novo: cada passo pula o que já existe.
#
# Uso (como root na VPS):  bash instalar-laya-vps.sh
set -euo pipefail

APP_DIR=/home/crmapp/app
LAYA_DIR=/opt/laya
PORTA=8765
URL="http://127.0.0.1:${PORTA}"

echo "== 1/6 Conferindo memória e disco"
DISPONIVEL_MB=$(free -m | awk '/^Mem:/ {print $7}')
DISCO_MB=$(df -Pm /opt | awk 'NR==2 {print $4}')
echo "   memória disponível: ${DISPONIVEL_MB} MB · disco livre em /opt: ${DISCO_MB} MB"
# O modelo multilíngue usa por volta de 2 GB de RAM em CPU e ~6 GB de disco
# (PyTorch CPU + pesos). Abaixo disso, parar: o CRM não pode ficar sem memória.
if [ "${DISPONIVEL_MB}" -lt 3000 ]; then echo "!! Menos de 3 GB de RAM livre. Instalação cancelada para não afetar o CRM."; exit 1; fi
if [ "${DISCO_MB}" -lt 8000 ]; then echo "!! Menos de 8 GB livres em disco. Instalação cancelada."; exit 1; fi

echo "== 2/6 Python e ambiente isolado em ${LAYA_DIR}"
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then
  echo "!! A Laya precisa de Python 3.10 ou mais novo."; python3 -V; exit 1
fi
if [ ! -x "${LAYA_DIR}/bin/python" ]; then
  apt-get install -y python3-venv >/dev/null 2>&1 || true
  python3 -m venv "${LAYA_DIR}"
fi
"${LAYA_DIR}/bin/python" -m pip install -q --upgrade pip

echo "== 3/6 PyTorch só para CPU (sem GPU na VPS) e Laya com o servidor HTTP"
"${LAYA_DIR}/bin/python" -m pip install -q torch --index-url https://download.pytorch.org/whl/cpu
"${LAYA_DIR}/bin/python" -m pip install -q "laya[serve]"
"${LAYA_DIR}/bin/python" -c 'import laya; print("   laya", getattr(laya, "__version__", "instalada"))'

echo "== 4/6 Serviço no PM2 do crmapp (nome: laya, só em 127.0.0.1:${PORTA})"
# Mesmo PM2 do crm-juridico (usuário crmapp): sobe junto com ele depois de
# um reinício da VPS. Poucas threads e um modelo carregado por vez, porque a
# Laya divide a máquina com o CRM.
comoCrm() { sudo -u crmapp -H bash -lc "$1"; }
comoCrm "pm2 describe laya >/dev/null 2>&1 && pm2 delete laya >/dev/null || true"
comoCrm "LAYA_HOST=127.0.0.1 LAYA_PORT=${PORTA} LAYA_MODELS=multilingual LAYA_DEFAULT_MODEL=multilingual \
  LAYA_DEVICE=cpu LAYA_THREADS=2 OMP_NUM_THREADS=2 LAYA_MAX_LOADED=1 LAYA_PRELOAD=1 \
  pm2 start ${LAYA_DIR}/bin/laya-serve --name laya --interpreter none --update-env && pm2 save >/dev/null"

echo "== 5/6 Esperando a Laya responder (1ª vez baixa o modelo, pode levar alguns minutos)"
for i in $(seq 1 90); do
  if curl -s -o /dev/null "${URL}/"; then break; fi
  sleep 10
done
RESPOSTA=$(curl -s -X POST "${URL}/v1/systemone" -H 'Content-Type: application/json' \
  -d '{"state":"Cliente: fui demitida grávida semana passada e não recebi nada","questions":{"area":{"type":"choice","instructions":"Qual a área do direito?","criteria":{"trabalhista":"emprego, demissão","familia":"pensão, guarda","previdenciario":"INSS"}}},"model":"multilingual"}' || true)
echo "   teste: ${RESPOSTA:0:300}"
if ! echo "${RESPOSTA}" | grep -q '"answers"'; then
  echo "!! A Laya não respondeu ao teste. O CRM NÃO foi alterado. Veja: pm2 logs laya --lines 50"; exit 1
fi

echo "== 6/6 Ligando o CRM à Laya (LAYA_URL no .env) e reiniciando"
# Reescreve o conteúdo no mesmo arquivo (">" mantém dono e permissão do .env,
# que é lido pelo usuário crmapp; "sed -i" recriaria o arquivo como root).
TMP=$(mktemp)
grep -v '^LAYA_URL=' "${APP_DIR}/.env" > "${TMP}" || true
echo "LAYA_URL=${URL}" >> "${TMP}"
cat "${TMP}" > "${APP_DIR}/.env"
rm -f "${TMP}"
# O crm-juridico roda no PM2 do crmapp (não no do root).
comoCrm "pm2 restart crm-juridico --update-env >/dev/null && pm2 save >/dev/null"
echo "== Pronto. Laya no ar em ${URL} e o CRM ligado a ela."
free -m | awk '/^Mem:/ {print "   memória livre agora: " $7 " MB"}'
