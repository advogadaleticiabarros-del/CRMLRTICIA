# Instala a ponte do Obsidian neste computador (Windows).
# Uso (PowerShell, na pasta do repositório):
#   powershell -ExecutionPolicy Bypass -File scripts\ponte-obsidian\instalar.ps1 [-Token <chave>] [-Cofre <pasta>]
# - Copia ponte.mjs para %LOCALAPPDATA%\crm-ponte-obsidian (fora do repositório,
#   para não depender do branch aberto na pasta do código).
# - Com -Token, grava %USERPROFILE%\.crm-ponte-obsidian.json (só este usuário lê).
#   A chave é a mesma de OBSIDIAN_PONTE_TOKEN no .env do servidor.
# - Registra a tarefa "CRM - ponte do Obsidian": inicia ao fazer logon, sem janela,
#   e reinicia sozinha se parar.
param(
  [string]$Servidor = 'https://crm.advogadaleticiabarros.com.br',
  [string]$Cofre = (Join-Path $env:USERPROFILE 'Documents\CRM LETICIA\CRMLeticia'),
  [string]$Token
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Cofre)) { throw "Cofre não encontrado: $Cofre (use -Cofre <pasta>)." }

$pasta = Join-Path $env:LOCALAPPDATA 'crm-ponte-obsidian'
New-Item -ItemType Directory -Force $pasta | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'ponte.mjs') (Join-Path $pasta 'ponte.mjs') -Force

$cfg = Join-Path $env:USERPROFILE '.crm-ponte-obsidian.json'
if ($Token) {
  $json = (@{ servidor = $Servidor; token = $Token; cofre = $Cofre } | ConvertTo-Json)
  [IO.File]::WriteAllText($cfg, $json, (New-Object Text.UTF8Encoding $false))
}
if (-not (Test-Path $cfg)) { throw "Falta a configuração $cfg (rode com -Token <chave>)." }
icacls $cfg /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

$node = (Get-Command node).Source
$nome = 'CRM - ponte do Obsidian'
$acao = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$node`" `"$pasta\ponte.mjs`""
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $opcoes `
  -Description 'Mantém o cofre do Obsidian e o CRM da Dra. Letícia em dia sozinho (Cérebro, modelos de peça, Clientes, manual).' -Force | Out-Null
Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $nome
Write-Output "Ponte do Obsidian instalada e iniciada. Log: $pasta\ponte.log"
