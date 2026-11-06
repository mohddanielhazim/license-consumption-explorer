# Installs License Consumption Explorer into a Dynatrace environment (Windows).
# No Node.js needed: it uploads the ready-built app in package\ with PowerShell,
# which comes with Windows. Asks for the environment address and an OAuth client
# with the scope app-engine:apps:install. Nothing typed here is saved anywhere.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
# Older Windows PowerShell may not offer TLS 1.2 by default; Dynatrace requires it.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

Write-Host "License Consumption Explorer: install`n"

$pkg = Get-ChildItem -Path "package" -Filter "app-v*.zip" -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
if (-not $pkg) {
  Write-Host "The app package (package\app-v....zip) is missing. Run this from the unzipped hand-over folder."
  exit 1
}

$envUrl = (Read-Host "Environment address (for example https://abc12345.apps.dynatrace.com)").TrimEnd("/")
if ($envUrl -match '^https://[^/]+\.apps\.dynatrace\.com$') { $sso = "https://sso.dynatrace.com" }
else {
  Write-Host "Use the environment's own address, like https://abc12345.apps.dynatrace.com."
  Write-Host "A company address (for example https://dynatrace.yourcompany.com) won't work here. The own address is the one"
  Write-Host "the browser shows after you sign in, or under Account Management > Environments."
  exit 1
}
# Ask the environment where it signs in (some use their own
# address); keep the default above if it doesn't say.
try {
  $req = [Net.HttpWebRequest]::Create("$envUrl/platform/oauth2/authorization/dynatrace-sso")
  $req.AllowAutoRedirect = $false
  $res = $req.GetResponse()
  $loc = $res.Headers["Location"]
  $res.Close()
  if ($loc -match '^(https://sso[^/]*\.dynatrace(labs)?\.com)') { $sso = $Matches[1] }
} catch {}
$clientId = Read-Host "OAuth client ID (dt0s02....)"
$secure = Read-Host "OAuth client secret (hidden as you type)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

Write-Host "`nSigning in with the OAuth client..."
try {
  $tokenResponse = Invoke-RestMethod -Method Post -Uri "$sso/sso/oauth2/token" -ContentType "application/x-www-form-urlencoded" -Body @{
    grant_type    = "client_credentials"
    client_id     = $clientId
    client_secret = $clientSecret
    scope         = "app-engine:apps:install"
  }
} catch {
  Write-Host "Sign-in failed. Check the client ID and secret, and that the client has the scope app-engine:apps:install."
  Write-Host "Dynatrace said: $($_.ErrorDetails.Message)"
  exit 1
} finally {
  $clientSecret = $null
}

Write-Host "Uploading $($pkg.Name) to $envUrl ..."
try {
  Invoke-RestMethod -Method Post -Uri "$envUrl/platform/app-engine/registry/v1/apps" -ContentType "application/zip" `
    -Headers @{ Authorization = "Bearer $($tokenResponse.access_token)" } -InFile $pkg.FullName | Out-Null
} catch {
  Write-Host "The upload failed."
  Write-Host "Dynatrace said: $($_.ErrorDetails.Message)"
  exit 1
}

Write-Host "`nDone. Open: $envUrl/ui/apps/my.license.consumption.explorer"
Write-Host "Then go through FIRST-RUN-CHECK.md."
