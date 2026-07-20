#Requires -Version 5.1

<#
.SYNOPSIS
Installs Grafana k6 on 64-bit Windows and verifies that it is immediately
available to the current PowerShell session.

.DESCRIPTION
Run this script from an elevated PowerShell window. Package managers are tried
in strict winget, Chocolatey, Scoop order. When none is installed, the script
downloads the latest official Windows amd64 archive from Grafana's GitHub
release, verifies its SHA-256 digest when release metadata supplies one, and
installs k6 under C:\Program Files\k6.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Update-CurrentProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machinePath, $userPath) | Where-Object { $_ }) -join ';'
}

function Add-ToMachinePath {
    param(
        [Parameter(Mandatory)]
        [string]$Directory
    )

    $normalizedDirectory = $Directory.TrimEnd('\')
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $entries = @($machinePath -split ';' | Where-Object { $_ })
    $alreadyPresent = $entries | Where-Object {
        $_.TrimEnd('\').Equals($normalizedDirectory, [StringComparison]::OrdinalIgnoreCase)
    }

    if (-not $alreadyPresent) {
        $newMachinePath = (@($entries) + $normalizedDirectory) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $newMachinePath, 'Machine')
    }
}

function Invoke-NativeInstaller {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    Write-Host "Attempting k6 installation with $Name..." -ForegroundColor Cyan
    & $Name @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "$Name exited with code $LASTEXITCODE."
        return $false
    }

    Update-CurrentProcessPath
    return [bool](Get-Command 'k6' -ErrorAction SilentlyContinue)
}

function Install-K6FromOfficialRelease {
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'The direct-download fallback requires 64-bit Windows.'
    }

    $releaseApi = 'https://api.github.com/repos/grafana/k6/releases/latest'
    $installDirectory = Join-Path $env:ProgramFiles 'k6'
    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("k6-install-{0}" -f [Guid]::NewGuid())
    $archivePath = Join-Path $temporaryDirectory 'k6-windows-amd64.zip'
    $checksumsPath = Join-Path $temporaryDirectory 'checksums.txt'
    $extractDirectory = Join-Path $temporaryDirectory 'expanded'

    New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host 'Resolving the latest official Grafana k6 release...' -ForegroundColor Cyan
        $headers = @{
            Accept = 'application/vnd.github+json'
            'User-Agent' = 'Endzone-Empire-k6-installer'
            'X-GitHub-Api-Version' = '2022-11-28'
        }
        $release = Invoke-RestMethod -Uri $releaseApi -Headers $headers -Method Get
        $asset = @($release.assets) | Where-Object {
            $_.name -match '^k6-v.+-windows-amd64\.zip$'
        } | Select-Object -First 1

        if (-not $asset) {
            throw "Release $($release.tag_name) does not contain a Windows amd64 zip asset."
        }

        Write-Host "Downloading $($asset.name)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $archivePath -UseBasicParsing

        $expectedHash = $null
        if ($asset.PSObject.Properties.Name -contains 'digest' -and $asset.digest) {
            $digestParts = [string]$asset.digest -split ':', 2
            if ($digestParts.Count -ne 2 -or $digestParts[0] -ne 'sha256') {
                throw "Unsupported release digest format: $($asset.digest)"
            }
            $expectedHash = $digestParts[1]
        }
        else {
            $checksumsAsset = @($release.assets) | Where-Object {
                $_.name -match 'checksums.*\.txt$'
            } | Select-Object -First 1
            if (-not $checksumsAsset) {
                throw 'The official release did not provide SHA-256 metadata or a checksums file.'
            }
            Invoke-WebRequest `
                -Uri $checksumsAsset.browser_download_url `
                -Headers $headers `
                -OutFile $checksumsPath `
                -UseBasicParsing
            $assetPattern = [Regex]::Escape([string]$asset.name)
            $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object {
                $_ -match "^([A-Fa-f0-9]{64})\s+\*?$assetPattern$"
            } | Select-Object -First 1
            if (-not $checksumLine) {
                throw "No SHA-256 entry for $($asset.name) was found in the official checksums file."
            }
            $expectedHash = ([Regex]::Match($checksumLine, '^[A-Fa-f0-9]{64}')).Value
        }

        $actualHash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash
        if (-not $actualHash.Equals($expectedHash, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'SHA-256 verification failed for the downloaded k6 archive.'
        }
        Write-Host 'SHA-256 verification passed.' -ForegroundColor Green

        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
        $binary = Get-ChildItem -LiteralPath $extractDirectory -Filter 'k6.exe' -File -Recurse |
            Select-Object -First 1
        if (-not $binary) {
            throw 'The downloaded archive did not contain k6.exe.'
        }

        New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
        Copy-Item -LiteralPath $binary.FullName -Destination (Join-Path $installDirectory 'k6.exe') -Force
        Add-ToMachinePath -Directory $installDirectory
    }
    finally {
        if (Test-Path -LiteralPath $temporaryDirectory) {
            Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
        }
    }
}

# Block 1: Fail closed unless the session is elevated.
if (-not (Test-IsAdministrator)) {
    Write-Error "ERROR: Please re-run this script in a PowerShell window launched as 'Run as Administrator'."
    exit 1
}

try {
    # Avoid reinstalling a working k6 binary.
    Update-CurrentProcessPath
    $installed = [bool](Get-Command 'k6' -ErrorAction SilentlyContinue)

    if (-not $installed) {
        # Block 2: Discover package managers and try them in strict priority order.
        $packageManagersFound = $false

        if (Get-Command 'winget' -ErrorAction SilentlyContinue) {
            $packageManagersFound = $true
            $installed = Invoke-NativeInstaller -Name 'winget' -Arguments @(
                'install', 'Grafana.k6', '--silent',
                '--accept-package-agreements', '--accept-source-agreements'
            )
        }

        if (-not $installed -and (Get-Command 'choco' -ErrorAction SilentlyContinue)) {
            $packageManagersFound = $true
            $installed = Invoke-NativeInstaller -Name 'choco' -Arguments @('install', 'k6', '-y')
        }

        if (-not $installed -and (Get-Command 'scoop' -ErrorAction SilentlyContinue)) {
            $packageManagersFound = $true
            $installed = Invoke-NativeInstaller -Name 'scoop' -Arguments @('install', 'k6')
        }

        if (-not $installed) {
            if ($packageManagersFound) {
                throw 'All discovered package-manager installation attempts failed.'
            }

            Write-Host 'No supported package manager found; using the official binary fallback.' -ForegroundColor Yellow
            Install-K6FromOfficialRelease
            Update-CurrentProcessPath
            $installed = [bool](Get-Command 'k6' -ErrorAction SilentlyContinue)
        }
    }

    # Block 3: Refresh PATH and verify the executable in this session.
    Update-CurrentProcessPath
    if (-not $installed -or -not (Get-Command 'k6' -ErrorAction SilentlyContinue)) {
        throw 'k6 installation completed, but k6.exe is not available on PATH.'
    }

    Write-Host 'Verifying installation:' -ForegroundColor Cyan
    & k6 version
    if ($LASTEXITCODE -ne 0) {
        throw "k6 version verification failed with exit code $LASTEXITCODE."
    }

    # Block 4: Confirm that the load-triage prerequisite gate is satisfied.
    Write-Host ''
    Write-Host 'SUCCESS: Grafana k6 is installed and available on PATH.' -ForegroundColor Green
    Write-Host 'SUCCESS: The run-load-triage.js pipeline fail-closed k6 gate is now unlocked.' -ForegroundColor Green
}
catch {
    Write-Error "ERROR: k6 installation failed. $($_.Exception.Message)"
    exit 1
}
