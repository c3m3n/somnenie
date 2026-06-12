param(
  [switch]$E2E,
  [string]$Url = "http://127.0.0.1:8766/"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

Invoke-CheckedCommand node --check app.js
Invoke-CheckedCommand node --check core\constants.js
Invoke-CheckedCommand node --check core\storage.js
Invoke-CheckedCommand node --check core\review.js
Invoke-CheckedCommand node --check core\quiz.js
Invoke-CheckedCommand node --test .\tools\quiz.test.mjs
Invoke-CheckedCommand node .\tools\test-review.mjs
Invoke-CheckedCommand node .\tools\smoke-test.mjs
Invoke-CheckedCommand powershell -ExecutionPolicy Bypass -File .\tools\validate-content.ps1

if ($E2E) {
  $env:NUTRIO_E2E_URL = $Url
  Invoke-CheckedCommand node .\tools\e2e-prod.mjs
}
