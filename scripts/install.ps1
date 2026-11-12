# Installs the latest Yobi for the current user. No administrator rights needed.
#
#   irm https://github.com/WellWells/yobi/releases/latest/download/install.ps1 | iex
#
# `iex` runs this inside your session, so everything stays in one script block and nothing calls
# `exit`, which would close your terminal.

& {
  $ErrorActionPreference = 'Stop'
  # Windows PowerShell repaints the progress bar for every chunk, which slows the download badly.
  $ProgressPreference = 'SilentlyContinue'

  $releaseBase = 'https://github.com/WellWells/yobi/releases/latest/download'
  $storeUrl = 'https://apps.microsoft.com/detail/9nnx8prfstc9'

  function Get-ManifestField([string] $manifest, [string] $name) {
    $match = [regex]::Match($manifest, "(?m)^${name}:\s*'?([^'\r\n]+?)'?\s*$")
    if (-not $match.Success) { throw "The release manifest has no $name." }
    return $match.Groups[1].Value
  }

  function Get-Sha512Base64([string] $filePath) {
    $sha512 = [Security.Cryptography.SHA512]::Create()
    $stream = [IO.File]::OpenRead($filePath)
    try {
      return [Convert]::ToBase64String($sha512.ComputeHash($stream))
    } finally {
      $stream.Dispose()
      $sha512.Dispose()
    }
  }

  $tempDir = Join-Path ([IO.Path]::GetTempPath()) "yobi-install-$([guid]::NewGuid())"

  try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Yobi needs 64-bit Windows.' }

    Write-Host 'Looking up the latest Yobi...'
    $manifest = [string] (Invoke-RestMethod "$releaseBase/latest.yml")
    $version = Get-ManifestField $manifest 'version'
    $fileName = Get-ManifestField $manifest 'path'
    $expectedHash = Get-ManifestField $manifest 'sha512'
    if ($fileName -notmatch '^[\w.-]+\.exe$') { throw "Unexpected installer name: $fileName" }

    Write-Host "Downloading Yobi $version..."
    $null = New-Item -ItemType Directory -Path $tempDir
    $installer = Join-Path $tempDir $fileName
    Invoke-WebRequest "$releaseBase/$fileName" -OutFile $installer -UseBasicParsing

    if ((Get-Sha512Base64 $installer) -cne $expectedHash) {
      throw 'The download does not match the checksum in the release.'
    }

    Write-Host 'Installing...'
    # -Wait would also wait for the app the installer opens. Reading Handle keeps ExitCode available.
    $process = Start-Process -FilePath $installer -ArgumentList '/S', '--force-run' -PassThru
    $null = $process.Handle
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "The installer stopped with code $($process.ExitCode)." }

    Write-Host "Yobi $version is installed and will keep itself up to date." -ForegroundColor Green
  } catch {
    Write-Host "Yobi was not installed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "If Windows blocked it, the Microsoft Store build will install: $storeUrl"
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
