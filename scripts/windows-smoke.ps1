param(
  [string]$AppRoot = "dist/OpenGlance-win32-x64",
  [string]$RepoRoot = (Get-Location).Path,
  [string]$ScreenshotPath = "dist/windows-smoke/home.png",
  [string]$LogPath = "dist/windows-smoke/windows-smoke.log",
  [int]$TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-SmokePath {
  param([string]$PathValue)

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return Join-Path (Get-Location).Path $PathValue
}

$appRootPath = Resolve-SmokePath $AppRoot
$repoRootPath = Resolve-SmokePath $RepoRoot
$screenshotPathValue = Resolve-SmokePath $ScreenshotPath
$logPathValue = Resolve-SmokePath $LogPath
$smokeDir = Split-Path -Parent $logPathValue
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null

function Write-SmokeLog {
  param([string]$Message)

  $line = "{0} {1}" -f (Get-Date -Format "o"), $Message
  $line | Tee-Object -FilePath $logPathValue -Append | Out-Host
}

function Save-DesktopScreenshot {
  param([string]$PathValue)

  $screenshotDir = Split-Path -Parent $PathValue
  New-Item -ItemType Directory -Force -Path $screenshotDir | Out-Null

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($PathValue, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Wait-OpenGlanceHealth {
  param(
    [int]$TimeoutSecondsValue,
    [string]$ExpectedRepoRoot = ""
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSecondsValue)
  $lastError = ""
  while ((Get-Date) -lt $deadline) {
    foreach ($port in 4317..4336) {
      $url = "http://127.0.0.1:$port/api/health"
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 10
        $payload = $response.Content | ConvertFrom-Json
        $repoMatches = !$ExpectedRepoRoot
        if ($ExpectedRepoRoot -and $payload.repoRoot) {
          $repoMatches = (
            [IO.Path]::GetFullPath([string]$payload.repoRoot) -ieq
            [IO.Path]::GetFullPath($ExpectedRepoRoot)
          )
        }
        if (
          $response.StatusCode -eq 200 -and
          $repoMatches
        ) {
          Write-SmokeLog "Health check passed at $url"
          return $url
        }
      } catch {
        $lastError = $_.Exception.Message
      }
    }
    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for OpenGlance health check. ExpectedRepoRoot=$ExpectedRepoRoot LastError=$lastError"
}

function Invoke-OpenGlanceSyncSmoke {
  param(
    [string]$HealthUrl,
    [string]$RepoRoot
  )

  $serverUrl = $HealthUrl.Substring(
    0,
    $HealthUrl.Length - "/api/health".Length
  )
  $syncUrl = "$serverUrl/api/git-sync?locale=en"
  $response = Invoke-WebRequest `
    -UseBasicParsing `
    -Uri $syncUrl `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"allChanges":true}' `
    -TimeoutSec 30
  $payload = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200 -or !$payload.ok) {
    $detail = $payload | ConvertTo-Json -Compress -Depth 5
    throw "Packaged App Sync failed. Status=$($response.StatusCode) Payload=$detail"
  }
  if ($payload.files -notcontains "README.md") {
    throw "Packaged App Sync did not publish the expected README.md change"
  }

  $hookMarker = Join-Path $RepoRoot ".git\git-leaf-hook-ran"
  if (!(Test-Path -LiteralPath $hookMarker)) {
    throw "Packaged App Sync did not execute the Node pre-commit hook"
  }
  if ((Get-Content -LiteralPath $hookMarker -Raw).Trim() -ne "ok") {
    throw "Packaged App Sync produced an invalid pre-commit hook marker"
  }

  $statusLines = @(git -C $RepoRoot status --porcelain)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read Git status after packaged App Sync"
  }
  if (($statusLines -join "`n").Trim()) {
    throw "Packaged App Sync left unpublished local changes"
  }

  $localHead = (git -C $RepoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read local HEAD after packaged App Sync"
  }
  $remoteLine = git -C $RepoRoot ls-remote origin refs/heads/main |
    Select-Object -First 1
  if ($LASTEXITCODE -ne 0 -or !$remoteLine) {
    throw "Could not read remote main after packaged App Sync"
  }
  $remoteHead = ([string]$remoteLine -split "\s+")[0]
  if ($localHead -ne $remoteHead -or $payload.publishedHead -ne $remoteHead) {
    throw "Packaged App Sync did not publish its exact local commit"
  }

  Write-SmokeLog "Sync and publish completed with Node hook: $localHead"
}

function Wait-OpenGlanceActiveDocument {
  param(
    [string]$ConfigPath,
    [string]$ExpectedPath,
    [int]$TimeoutSecondsValue
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSecondsValue)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $ConfigPath) {
      $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
      if ($config.preferences -and $config.preferences.workbenchSessions) {
        $activePaths = @(
          $config.preferences.workbenchSessions.PSObject.Properties |
            ForEach-Object { $_.Value.activeTabPath }
        )
        if ($activePaths -contains $ExpectedPath) {
          Write-SmokeLog "Workbench active document: $ExpectedPath"
          return
        }
      }
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Timed out waiting for workbench activeTabPath=$ExpectedPath"
}

$exePath = Join-Path $appRootPath "OpenGlance.exe"
$installedRoot = Join-Path $env:LOCALAPPDATA "OpenGlance\app"
$installedExe = Join-Path $installedRoot "OpenGlance.exe"
$installedState = Join-Path $env:LOCALAPPDATA "OpenGlance\install-state.json"
$legacyInstallParent = Join-Path $env:LOCALAPPDATA "GitLeaf"
$legacyInstallRoot = Join-Path $legacyInstallParent "app"
$legacyExe = Join-Path $legacyInstallRoot "Git Leaf.exe"
$legacyState = Join-Path $legacyInstallParent "install-state.json"
$legacyShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Git Leaf.lnk"
$desktopConfig = Join-Path $env:APPDATA "git-leaf\desktop-config.json"
$protocolCommandKeys = @(
  "Registry::HKEY_CURRENT_USER\Software\Classes\openglance\shell\open\command",
  "Registry::HKEY_CURRENT_USER\Software\Classes\git-leaf\shell\open\command"
)
if (!(Test-Path -LiteralPath $exePath)) {
  throw "Missing packaged executable: $exePath"
}
if (!(Test-Path -LiteralPath $repoRootPath)) {
  throw "Missing smoke repository root: $repoRootPath"
}

$expectedVersion = (Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json).version
$process = $null
$blockedUpgradeProcess = $null
try {
  $installParent = Split-Path -Parent $installedRoot
  if (Test-Path -LiteralPath $installParent) {
    Remove-Item -LiteralPath $installParent -Recurse -Force
  }
  if (Test-Path -LiteralPath $legacyInstallParent) {
    Remove-Item -LiteralPath $legacyInstallParent -Recurse -Force
  }
  if (Test-Path -LiteralPath $desktopConfig) {
    Remove-Item -LiteralPath $desktopConfig -Force
  }
  New-Item -ItemType Directory -Force -Path $legacyInstallRoot | Out-Null
  Set-Content -LiteralPath $legacyExe -Encoding utf8 -Value "legacy Git Leaf executable"
  @{ version = "1.21.0"; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $legacyState -Encoding utf8
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $legacyShortcut) | Out-Null
  Set-Content -LiteralPath $legacyShortcut -Encoding utf8 -Value "legacy Git Leaf shortcut"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $desktopConfig) | Out-Null
  [ordered]@{
    repoRoot = $repoRootPath
    openRepoRoots = @($repoRootPath)
    preferences = [ordered]@{
      colorMode = "dark"
      language = "zh-CN"
    }
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $desktopConfig -Encoding utf8

  Write-SmokeLog "Starting OpenGlance 3.0 over a Git Leaf 1.21.0 fixed installation"
  Write-SmokeLog "Smoke repository root: $repoRootPath"
  $process = Start-Process -FilePath $exePath -ArgumentList @("--repo", "`"$repoRootPath`"") -PassThru
  Write-SmokeLog "Started OpenGlance process: $($process.Id)"

  $healthUrl = Wait-OpenGlanceHealth `
    -TimeoutSecondsValue $TimeoutSeconds `
    -ExpectedRepoRoot $repoRootPath
  if (!(Test-Path -LiteralPath $installedExe)) {
    throw "OpenGlance did not bootstrap to the stable per-user path: $installedExe"
  }
  if (!(Test-Path -LiteralPath $installedState)) {
    throw "OpenGlance did not write the installed version state: $installedState"
  }
  $installedVersion = (Get-Content -LiteralPath $installedState -Raw | ConvertFrom-Json).version
  if ($installedVersion -ne $expectedVersion) {
    throw "Installed version state mismatch: expected=$expectedVersion actual=$installedVersion"
  }
  if (Test-Path -LiteralPath $legacyInstallParent) {
    throw "OpenGlance did not remove the superseded Git Leaf installation: $legacyInstallParent"
  }
  if (Test-Path -LiteralPath $legacyShortcut) {
    throw "OpenGlance did not remove the superseded Git Leaf shortcut: $legacyShortcut"
  }
  $preservedConfig = Get-Content -LiteralPath $desktopConfig -Raw | ConvertFrom-Json
  if ($preservedConfig.openRepoRoots -notcontains $repoRootPath) {
    throw "OpenGlance did not preserve the Git Leaf repository list"
  }
  if (
    $preservedConfig.preferences.colorMode -ne "dark" -or
    $preservedConfig.preferences.language -ne "zh-CN"
  ) {
    throw "OpenGlance did not preserve Git Leaf appearance or language preferences"
  }
  Write-SmokeLog "Git Leaf 1.21.0 installation and Profile migrated with user state preserved"
  foreach ($protocolCommandKey in $protocolCommandKeys) {
    if (!(Test-Path -LiteralPath $protocolCommandKey)) {
      throw "OpenGlance did not register protocol key: $protocolCommandKey"
    }
    $protocolCommand = (Get-Item -LiteralPath $protocolCommandKey).GetValue("")
    if (!$protocolCommand.Contains($installedExe)) {
      throw "Protocol does not point to the stable executable: $protocolCommand"
    }
    Write-SmokeLog "Protocol command: $protocolCommand"
  }
  Write-SmokeLog "Stable executable: $installedExe"
  Write-SmokeLog "Installed version: $installedVersion"
  Invoke-OpenGlanceSyncSmoke -HealthUrl $healthUrl -RepoRoot $repoRootPath

  $stableHashBefore = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
  @{ version = "0.0.0"; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Verifying that a running app blocks a manual cross-version replacement"
  $blockedUpgradeProcess = Start-Process -FilePath $exePath -PassThru
  Start-Sleep -Seconds 3
  $blockedUpgradeProcess.Refresh()
  if ($blockedUpgradeProcess.HasExited) {
    throw "The manual upgrade process exited before the running-app guard was observed"
  }
  $guardedVersion = (Get-Content -LiteralPath $installedState -Raw | ConvertFrom-Json).version
  if ($guardedVersion -ne "0.0.0") {
    throw "Manual cross-version replacement modified install state while the app was running"
  }
  $stableHashAfter = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
  if ($stableHashAfter -ne $stableHashBefore) {
    throw "Manual cross-version replacement modified the running stable executable"
  }
  Stop-Process -Id $blockedUpgradeProcess.Id -Force -ErrorAction SilentlyContinue
  $blockedUpgradeProcess.WaitForExit(5000) | Out-Null
  $blockedUpgradeProcess = $null
  @{ version = $expectedVersion; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Manual cross-version replacement left the stable executable unchanged"

  $deepLinkPath = "docs/notes.md"
  $encodedRepoRoot = [Uri]::EscapeDataString($repoRootPath)
  $deepLink = "openglance://open?repo=$encodedRepoRoot&path=docs%2Fnotes.md"
  Write-SmokeLog "Opening registered protocol deep link: $deepLinkPath"
  Start-Process -FilePath $deepLink
  # initialFile describes server startup. Reused workbenches acknowledge the
  # active document through persisted session state instead of restarting it.
  $healthUrl = Wait-OpenGlanceHealth `
    -TimeoutSecondsValue $TimeoutSeconds `
    -ExpectedRepoRoot $repoRootPath
  Wait-OpenGlanceActiveDocument `
    -ConfigPath $desktopConfig `
    -ExpectedPath $deepLinkPath `
    -TimeoutSecondsValue $TimeoutSeconds
  Write-SmokeLog "Deep link opened requested document: $deepLinkPath"

  $legacyDeepLinkPath = "README.md"
  $legacyDeepLink = "git-leaf://open?repo=$encodedRepoRoot&path=README.md"
  Write-SmokeLog "Opening Git Leaf 1.x compatibility deep link: $legacyDeepLinkPath"
  Start-Process -FilePath $legacyDeepLink
  $healthUrl = Wait-OpenGlanceHealth `
    -TimeoutSecondsValue $TimeoutSeconds `
    -ExpectedRepoRoot $repoRootPath
  Wait-OpenGlanceActiveDocument `
    -ConfigPath $desktopConfig `
    -ExpectedPath $legacyDeepLinkPath `
    -TimeoutSecondsValue $TimeoutSeconds
  Write-SmokeLog "Git Leaf 1.x deep link opened requested document: $legacyDeepLinkPath"

  Write-SmokeLog "Starting the same package again to verify stable-app redirect"
  $redirectProcess = Start-Process -FilePath $exePath -ArgumentList @("--repo", "`"$repoRootPath`"") -PassThru
  if (!$redirectProcess.WaitForExit(15000)) {
    throw "Same-version package did not redirect to the stable app"
  }
  if ($redirectProcess.ExitCode -ne 0) {
    throw "Same-version redirect failed. ExitCode=$($redirectProcess.ExitCode)"
  }
  Write-SmokeLog "Same-version package redirected to the stable app"

  @{ version = "999.0.0"; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Starting the package with a newer installed-version marker to verify downgrade blocking"
  $outdatedProcess = Start-Process -FilePath $exePath -ArgumentList @("--repo", "`"$repoRootPath`"") -PassThru
  if (!$outdatedProcess.WaitForExit(15000)) {
    throw "Outdated package did not hand off to the newer stable app"
  }
  if ($outdatedProcess.ExitCode -ne 0) {
    throw "Outdated package handoff failed. ExitCode=$($outdatedProcess.ExitCode)"
  }
  @{ version = $expectedVersion; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Outdated package was blocked from downgrading the stable app"
  Start-Sleep -Seconds 2
  Save-DesktopScreenshot -PathValue $screenshotPathValue
  Write-SmokeLog "Saved screenshot: $screenshotPathValue"
  Write-SmokeLog "Windows smoke passed: $healthUrl"
} catch {
  Write-SmokeLog "Windows smoke failed: $_"
  try {
    Save-DesktopScreenshot -PathValue $screenshotPathValue
    Write-SmokeLog "Saved failure screenshot: $screenshotPathValue"
  } catch {
    Write-SmokeLog "Could not save failure screenshot: $_"
  }
  throw
} finally {
  if ($blockedUpgradeProcess -and !$blockedUpgradeProcess.HasExited) {
    Stop-Process -Id $blockedUpgradeProcess.Id -Force -ErrorAction SilentlyContinue
    $blockedUpgradeProcess.WaitForExit(5000) | Out-Null
  }
  if (Test-Path -LiteralPath $installedState) {
    @{ version = $expectedVersion; installedAt = (Get-Date -Format "o") } |
      ConvertTo-Json |
      Set-Content -LiteralPath $installedState -Encoding utf8
  }
  if ($process -and !$process.HasExited) {
    Write-SmokeLog "Stopping OpenGlance process: $($process.Id)"
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
  }
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -eq $installedExe } |
    ForEach-Object {
      Write-SmokeLog "Stopping installed OpenGlance process: $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
