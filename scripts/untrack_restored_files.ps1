<#
Script: untrack_restored_files.ps1
But: retire du suivi Git les fichiers restaurés, ajoute .gitignore, commit, optionnellement push
Usage:
  .\untrack_restored_files.ps1            # dry-run
  .\untrack_restored_files.ps1 -Perform  # exécute les commandes
  .\untrack_restored_files.ps1 -Perform -Push  # exécute et pousse
#>

param(
    [switch]$Perform,
    [switch]$Push
)

function ExecGit([string]$cmd) {
    Write-Host "> $cmd"
    $proc = Start-Process -FilePath git -ArgumentList $cmd -NoNewWindow -Wait -PassThru -RedirectStandardOutput stdout.txt -RedirectStandardError stderr.txt
    $out = Get-Content stdout.txt -Raw -ErrorAction SilentlyContinue
    $err = Get-Content stderr.txt -Raw -ErrorAction SilentlyContinue
    Remove-Item -Force stdout.txt,stderr.txt -ErrorAction SilentlyContinue
    if ($out) { Write-Host $out }
    if ($err) { Write-Host $err }
    return $proc.ExitCode
}

$gitRoot = (& git rev-parse --show-toplevel) 2>$null
if (-not $?) {
    Write-Error "Ce dossier n'est pas dans un dépôt Git ou git n'est pas installé."
    exit 1
}

Set-Location $gitRoot

$files = @(
    "custom_nodes/ComfyUI-Majoor-AssetsManager/AGENTS.md",
    "custom_nodes/ComfyUI-Majoor-AssetsManager/ROADMAP.md",
    "custom_nodes/ComfyUI-Majoor-AssetsManager/VERSION",
    "custom_nodes/ComfyUI-Majoor-AssetsManager/eslint.config.js"
)

Write-Host "Fichiers ciblés (dry-run si -Perform non fourni):"
$files | ForEach-Object { Write-Host " - $_" }

if (-not $Perform) {
    Write-Host "Dry-run: re-lancer avec -Perform pour exécuter les actions." -ForegroundColor Yellow
    exit 0
}

foreach ($f in $files) {
    ExecGit("rm --cached --ignore-unmatch -- '$f'") | Out-Null
}

# Ajouter .gitignore modifié
ExecGit("add custom_nodes/ComfyUI-Majoor-AssetsManager/.gitignore") | Out-Null

ExecGit("add -A") | Out-Null

$msg = "Untrack restored files and ignore them (AGENTS, ROADMAP, VERSION, eslint.config.js)"
ExecGit("commit -m '$msg'") | Out-Null

if ($Push) {
    Write-Host "Pushing to remote..."
    ExecGit("push") | Out-Null
}

Write-Host "Terminé. Vérifiez les résultats avec 'git status'."
