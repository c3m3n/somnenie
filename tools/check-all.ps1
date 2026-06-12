param(
  [switch]$E2E,
  [string]$Url = "http://127.0.0.1:8766/"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

node --check app.js
node --check core\storage.js
node --check core\review.js
node .\tools\test-review.mjs
node .\tools\smoke-test.mjs
powershell -ExecutionPolicy Bypass -File .\tools\validate-content.ps1

if ($E2E) {
  $env:NUTRIO_E2E_URL = $Url
  node .\tools\e2e-prod.mjs
}
