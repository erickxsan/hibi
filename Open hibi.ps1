$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:4173/"
$viteScript = Join-Path $appRoot "node_modules\vite\bin\vite.js"

function Test-Hibi {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

if (-not (Test-Hibi)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js was not found. Install Node.js, then run this launcher again."
  }

  if (-not (Test-Path -LiteralPath $viteScript)) {
    throw "The web app dependencies are missing. Run 'pnpm install' in $appRoot first."
  }

  # Development mode intentionally preserves the private local-only fallback.
  $serverArguments = "`"$viteScript`" --host 127.0.0.1 --port 4173 --strictPort"
  $serverOut = Join-Path $env:TEMP "hibi-server.out.log"
  $serverError = Join-Path $env:TEMP "hibi-server.error.log"

  Start-Process -FilePath $nodeCommand.Source `
    -ArgumentList $serverArguments `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $serverOut `
    -RedirectStandardError $serverError

  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and -not (Test-Hibi)) {
    Start-Sleep -Milliseconds 250
  }

  if (-not (Test-Hibi)) {
    $details = if (Test-Path -LiteralPath $serverError) {
      (Get-Content -LiteralPath $serverError -Tail 8) -join [Environment]::NewLine
    }
    else {
      "No server log was created."
    }
    throw "The local hibi server did not start on port 4173.`n$details"
  }
}

Start-Process $url
