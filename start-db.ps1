# Inicia o MySQL local de desenvolvimento do CRM.
# Uso: clique direito > "Executar com PowerShell", ou rode:  ./start-db.ps1
$mysqld  = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe"
$dataDir = "C:\Users\advog\AppData\Local\MySQLData"

$port = Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue -InformationLevel Quiet
if ($port) {
  Write-Host "MySQL ja esta rodando em 127.0.0.1:3306" -ForegroundColor Green
} else {
  Start-Process -FilePath $mysqld -ArgumentList "--datadir=`"$dataDir`"","--port=3306","--bind-address=127.0.0.1" -WindowStyle Hidden
  Start-Sleep -Seconds 6
  Write-Host "MySQL iniciado em 127.0.0.1:3306" -ForegroundColor Green
}
