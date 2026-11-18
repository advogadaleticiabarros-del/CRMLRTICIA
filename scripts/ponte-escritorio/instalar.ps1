# Instala a ponte do escritório -> TJES neste computador (Windows).
# Uso (PowerShell, na pasta do repositório):
#   powershell -ExecutionPolicy Bypass -File scripts\ponte-escritorio\instalar.ps1 [-Token <chave>]
# - Copia ponte.mjs para %LOCALAPPDATA%\crm-ponte-escritorio (fica fora do repositório,
#   para não depender do branch aberto na pasta do código).
# - Com -Token, grava %USERPROFILE%\.crm-ponte-escritorio.json (só este usuário lê).
#   A chave é a mesma de MNI_PONTE_TOKEN no .env do servidor.
# - Registra a tarefa "CRM - ponte do TJES": inicia ao fazer logon, sem janela,
#   e reinicia sozinha se parar.
param(
  [string]$Servidor = 'https://crm.advogadaleticiabarros.com.br',
  [string]$Token
)
$ErrorActionPreference = 'Stop'

$pasta = Join-Path $env:LOCALAPPDATA 'crm-ponte-escritorio'
New-Item -ItemType Directory -Force $pasta | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'ponte.mjs') (Join-Path $pasta 'ponte.mjs') -Force

$cfg = Join-Path $env:USERPROFILE '.crm-ponte-escritorio.json'
if ($Token) {
  $json = (@{ servidor = $Servidor; token = $Token } | ConvertTo-Json)
  [IO.File]::WriteAllText($cfg, $json, (New-Object Text.UTF8Encoding $false))
}
if (-not (Test-Path $cfg)) { throw "Falta a configuração $cfg (rode com -Token <chave>)." }
icacls $cfg /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

$node = (Get-Command node).Source
$nome = 'CRM - ponte do TJES'
$acao = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$node`" `"$pasta\ponte.mjs`""
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $opcoes `
  -Description 'Consulta o TJES pela rede do escritório para o CRM da Dra. Letícia (o TJES bloqueia o servidor do CRM).' -Force | Out-Null
Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $nome
Write-Output "Ponte instalada e iniciada. Log: $pasta\ponte.log"
