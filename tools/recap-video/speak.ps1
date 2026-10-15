# Reads a manifest (JSON array of { file, text }) and writes one WAV per entry with a Windows voice (System.Speech, offline).
#   powershell -File speak.ps1 -Manifest manifest.json -Voice "Microsoft Zira Desktop" -Rate -1
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$Voice,
  [int]$Rate = -1
)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.Rate = $Rate
$synth.Volume = 100
$items = Get-Content -Raw -Encoding UTF8 -Path $Manifest | ConvertFrom-Json
foreach ($item in $items) {
  $dir = Split-Path -Parent $item.file
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $synth.SetOutputToWaveFile($item.file)
  $synth.Speak($item.text)
  $synth.SetOutputToNull()
}
$synth.Dispose()
Write-Output ("spoke {0} files with {1}" -f @($items).Count, $Voice)
