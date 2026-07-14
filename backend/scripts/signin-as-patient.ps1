# signin-as-patient.ps1 — mint a JWT for any seeded local patient
#
# Usage:
#   .\backend\scripts\signin-as-patient.ps1                              # defaults to priya.menon@cardioplace.test
#   .\backend\scripts\signin-as-patient.ps1 aisha.johnson@cardioplace.test
#   .\backend\scripts\signin-as-patient.ps1 james.okafor@cardioplace.test
#
# Requires: backend running on http://localhost:4000 (npm run start:dev in /backend)
# All local-seeded patients have perma-OTP 666666 (see backend/prisma/seed/patients.ts)
#
# Output: prints the access token + a one-liner Authorization header you can
# paste into any smoke-test script.

param(
  [string]$Email = "priya.menon@cardioplace.test",
  [string]$Otp   = "666666",
  [string]$BackendUrl = "http://localhost:4000"
)

$DeviceId = "smoke-test-$(Get-Date -Format 'yyyyMMddHHmmss')"

$body = @{
  email     = $Email
  otp       = $Otp
  deviceId  = $DeviceId
} | ConvertTo-Json

Write-Host ""
Write-Host "Signing in as $Email ..." -ForegroundColor Cyan

try {
  $response = Invoke-RestMethod `
    -Uri "$BackendUrl/api/v2/auth/otp/verify" `
    -Method Post `
    -ContentType "application/json" `
    -Headers @{ "x-device-id" = $DeviceId } `
    -Body $body
} catch {
  Write-Host ""
  Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails.Message) {
    Write-Host "  Server said: $($_.ErrorDetails.Message)" -ForegroundColor Red
  }
  Write-Host ""
  Write-Host "  Common causes:" -ForegroundColor Yellow
  Write-Host "    - Backend not running (start with: cd backend; npm run start:dev)"
  Write-Host "    - Patient email not in local DB (run: cd backend; npx prisma db seed)"
  Write-Host "    - Wrong DATABASE_URL active in backend/.env (must be localhost:5433)"
  exit 1
}

Write-Host ""
Write-Host "  Signed in." -ForegroundColor Green
Write-Host "    userId : $($response.userId)"
Write-Host "    roles  : $($response.roles -join ', ')"
Write-Host ""

Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host "ACCESS TOKEN (paste into your smoke-test script):" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host $response.accessToken
Write-Host ""

Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host "ONE-LINER for curl / Invoke-RestMethod:" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host "`$env:TOKEN = '$($response.accessToken)'"
Write-Host ""
Write-Host "  Then in your smoke script use:"
Write-Host "    -Headers @{ Authorization = ""Bearer `$env:TOKEN"" }"
Write-Host ""
