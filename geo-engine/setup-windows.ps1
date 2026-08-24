<#
  התקנה והרצה של geo-engine על Windows.
  כל מה שקורה נשמר ליומן, והחלון לא נסגר לעולם בלי הודעה.
#>

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$LogBase = $env:USERPROFILE
if (-not $LogBase) { $LogBase = $HOME }
$LogPath = Join-Path $LogBase 'geo-engine-log.txt'
$Transcribing = $false
try { Start-Transcript -Path $LogPath -Force | Out-Null; $Transcribing = $true } catch {}

$Branch  = 'claude/already-sending-continued-np8pr6'
$RepoUrl = 'https://github.com/moti-lang/my-crm.git'
$Root    = Join-Path $HOME 'my-crm'
$Proj    = Join-Path $Root 'geo-engine'

function Step($n, $m) { Write-Host ''; Write-Host "[$n] $m" -ForegroundColor Cyan }
function Good($m)     { Write-Host "    $m" -ForegroundColor Green }
function Info($m)     { Write-Host "    $m" -ForegroundColor Gray }
function Die($m)      { throw (New-Object System.Exception("GEO::" + $m)) }
function Have($c)     { $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath {
  $mp = [Environment]::GetEnvironmentVariable('Path','Machine')
  $up = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$mp;$up"
}

try {

  Write-Host ''
  Write-Host '  מנוע בדיקת נראות — התקנה והרצה' -ForegroundColor White
  Write-Host '  שב ותן לזה לרוץ. אל תסגור את החלון.' -ForegroundColor Gray

  # ---------- 0. אבחון ----------
  Step 0 'אוסף פרטי מערכת'
  Info ("PowerShell : " + $PSVersionTable.PSVersion.ToString())
  Info ("מערכת      : " + [Environment]::OSVersion.VersionString)
  Info ("64 סיביות  : " + [Environment]::Is64BitOperatingSystem)
  Info ("node       : " + $(if (Have 'node')   { (& node -v) 2>$null } else { 'לא מותקן' }))
  Info ("git        : " + $(if (Have 'git')    { 'מותקן' } else { 'לא מותקן' }))
  Info ("winget     : " + $(if (Have 'winget') { 'זמין' }  else { 'לא זמין' }))
  Info ("יומן       : " + $LogPath)

  # ---------- 1. Node ----------
  Step 1 'בודק Node.js'
  $nodeOk = $false
  if (Have 'node') {
    $v = (& node -v) 2>$null
    if ($v -match '^v(\d+)\.') {
      if ([int]$Matches[1] -ge 20) { Good "Node $v תקין"; $nodeOk = $true }
      else { Info "Node $v ישן מדי, צריך 20 ומעלה" }
    }
  }
  if (-not $nodeOk) {
    if (-not (Have 'winget')) {
      Die 'Node.js חסר ו-winget לא זמין במחשב הזה. התקן ידנית מ- https://nodejs.org/en/download (גרסה 22 LTS, קובץ msi), ואז הרץ שוב את RUN-ME.bat'
    }
    Info 'מתקין Node.js — כמה דקות, ייתכן שתתבקש לאשר'
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    RefreshPath
    if (-not (Have 'node')) {
      Die 'Node הותקן אבל החלון הנוכחי עדיין לא מזהה אותו. סגור את החלון והרץ שוב את RUN-ME.bat — בפעם השנייה זה יעבוד.'
    }
    Good ("Node " + (& node -v) + " הותקן")
  }

  # ---------- 2. Git ----------
  Step 2 'בודק Git'
  if (Have 'git') { Good 'Git מותקן' }
  else {
    if (-not (Have 'winget')) { Die 'Git חסר ו-winget לא זמין. התקן מ- https://git-scm.com ואז הרץ שוב.' }
    Info 'מתקין Git'
    & winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    RefreshPath
    if (-not (Have 'git')) { Die 'Git הותקן אבל החלון לא מזהה אותו. סגור את החלון והרץ שוב את RUN-ME.bat' }
    Good 'Git הותקן'
  }

  # ---------- 3. הפרויקט ----------
  Step 3 'מוריד את הפרויקט'
  if (Test-Path (Join-Path $Root '.git')) {
    Info 'קיים כבר — מושך עדכונים'
    Set-Location $Root
    & git fetch origin $Branch 2>&1 | Out-Null
    & git checkout $Branch    2>&1 | Out-Null
    & git pull origin $Branch 2>&1 | Out-Null
    Good 'עודכן'
  } else {
    if (Test-Path $Root) { Die "התיקייה $Root קיימת אבל אינה פרויקט Git. שנה את שמה או מחק אותה והרץ שוב." }
    & git clone -b $Branch $RepoUrl $Root 2>&1 | Out-Null
    if (-not (Test-Path $Proj)) { Die 'ההורדה נכשלה. בדוק חיבור לאינטרנט והרץ שוב.' }
    Good "הורד אל $Root"
  }
  Set-Location $Proj

  # ---------- 4. ספריות ----------
  Step 4 'מתקין ספריות — 2 עד 5 דקות'
  & npm install --no-audit --no-fund 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'התקנת הספריות נכשלה. שלח לי את היומן.' }
  Good 'הותקנו'

  # ---------- 5. דפדפן ----------
  Step 5 'מוריד דפדפן ייעודי — כ-150 מגה'
  & npx playwright install chromium 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'הורדת הדפדפן נכשלה. בדוק חיבור והרץ שוב.' }
  Good 'הורד'

  # ---------- 6-7. בדיקות ----------
  Step 6 'בודק את הלוגיקה'
  & npm test 2>&1 | ForEach-Object { if ($_ -match 'עברו|נכשלו') { Info $_ } }
  if ($LASTEXITCODE -ne 0) { Die 'בדיקות הלוגיקה נכשלו. זו בעיה בקוד ולא אצלך — שלח לי את היומן.' }
  Good 'עברו'

  Step 7 'בודק דפדפן ודרייבר — ייפתח חלון לרגע'
  & npm run smoke 2>&1 | ForEach-Object { if ($_ -match 'עברו|נכשלו') { Info $_ } }
  if ($LASTEXITCODE -ne 0) { Die 'בדיקת הדפדפן נכשלה. שלח לי את היומן — זו לא בעיית סלקטורים.' }
  Good 'תקין — מכאן, כל כשל הוא סלקטור שהתיישן'

  # ---------- 8. לקוח ----------
  Step 8 'טוען את לקוח הדוגמה'
  & node src/cli.js "client:add" clients/example.json 2>&1 | ForEach-Object { Info $_ }
  if ($LASTEXITCODE -ne 0) { Die 'טעינת הלקוח נכשלה.' }

  # ---------- 9. ריצה ----------
  Write-Host ''
  Write-Host '════════════════════════════════════════' -ForegroundColor Yellow
  Write-Host ' הריצה האמיתית — 10 עד 15 דקות.' -ForegroundColor Yellow
  Write-Host ' ייפתח דפדפן. אל תיגע בו ואל תסגור אותו.' -ForegroundColor Yellow
  Write-Host ' המתנה בין שאלות נראית כמו תקיעה — היא מכוונת.' -ForegroundColor Yellow
  Write-Host '════════════════════════════════════════' -ForegroundColor Yellow
  Read-Host ' Enter כדי להתחיל'

  & node src/cli.js run goldfish --engine=chatgpt 2>&1 | ForEach-Object { Write-Host $_ }

  Write-Host ''
  Write-Host ' הריצה הסתיימה.' -ForegroundColor Green
  try { Start-Process explorer.exe $Proj } catch {}

}
catch {
  $msg = $_.Exception.Message
  Write-Host ''
  Write-Host '════════════════════════════════════════' -ForegroundColor Red
  if ($msg -like 'GEO::*') {
    Write-Host (' ' + $msg.Substring(5)) -ForegroundColor Red
  } else {
    Write-Host ' שגיאה בלתי צפויה:' -ForegroundColor Red
    Write-Host ('   ' + $msg) -ForegroundColor Red
    try {
      Write-Host ('   שורה: ' + $_.InvocationInfo.ScriptLineNumber) -ForegroundColor DarkGray
      Write-Host ('   פקודה: ' + $_.InvocationInfo.Line.Trim()) -ForegroundColor DarkGray
    } catch {}
  }
  Write-Host '════════════════════════════════════════' -ForegroundColor Red
}
finally {
  try { if ($Transcribing) { Stop-Transcript | Out-Null } } catch {}
  Write-Host ''
  Write-Host ' ─────────────────────────────────────' -ForegroundColor White
  Write-Host '  שלח לי את הקובץ הזה:' -ForegroundColor White
  Write-Host ("  " + $LogPath) -ForegroundColor Yellow
  Write-Host ' ─────────────────────────────────────' -ForegroundColor White
  try { Start-Process explorer.exe ('/select,"' + $LogPath + '"') } catch {}
  Write-Host ''
  Read-Host ' Enter לסגירה'
}
