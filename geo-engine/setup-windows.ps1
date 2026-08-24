#Requires -Version 5.1
<#
  התקנה והרצה אוטומטית של geo-engine על Windows.
  עושה הכל לבד: מתקין Node ו-Git אם חסרים, מוריד את הפרויקט,
  מתקין ספריות ודפדפן, מריץ בדיקות, ואז מריץ בדיקה אמיתית מול ChatGPT.
  עוצר עם הודעה ברורה בעברית בכל כשל.
#>

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Branch  = 'claude/already-sending-continued-np8pr6'
$RepoUrl = 'https://github.com/moti-lang/my-crm.git'
$Root    = Join-Path $HOME 'my-crm'
$Proj    = Join-Path $Root 'geo-engine'

function Step($n, $m) { Write-Host ''; Write-Host "[$n] $m" -ForegroundColor Cyan }
function Good($m)     { Write-Host "    $m" -ForegroundColor Green }
function Info($m)     { Write-Host "    $m" -ForegroundColor Gray }
function Die($m) {
  Write-Host ''
  Write-Host '════════════════════════════════════════' -ForegroundColor Red
  Write-Host " עצירה: $m" -ForegroundColor Red
  Write-Host '════════════════════════════════════════' -ForegroundColor Red
  Write-Host ' העתק את כל החלון הזה ושלח לי. אל תנסה לתקן לבד.' -ForegroundColor Yellow
  Read-Host ' Enter לסגירה'
  exit 1
}
function Have($c) { $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath {
  $m = [Environment]::GetEnvironmentVariable('Path','Machine')
  $u = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$m;$u"
}

Write-Host ''
Write-Host '  מנוע בדיקת נראות — התקנה והרצה' -ForegroundColor White
Write-Host '  אין צורך לעשות כלום. שב ותן לזה לרוץ.' -ForegroundColor Gray

# ---------- 1. Node ----------
Step 1 'בודק Node.js'
$nodeOk = $false
if (Have 'node') {
  $v = (& node -v) 2>$null
  if ($v -match '^v(\d+)\.') {
    $maj = [int]$Matches[1]
    if ($maj -ge 20) { Good "Node $v מותקן"; $nodeOk = $true }
    else { Info "Node $v ישן מדי (צריך 20 ומעלה)" }
  }
}
if (-not $nodeOk) {
  if (-not (Have 'winget')) {
    Die 'Node.js לא מותקן, וגם winget לא זמין. התקן ידנית מ- https://nodejs.org/en/download (גרסה 22 LTS, קובץ msi), ואז הרץ את הסקריפט הזה שוב.'
  }
  Info 'מתקין Node.js 22 — כמה דקות, ייתכן שתתבקש לאשר'
  & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
  RefreshPath
  if (-not (Have 'node')) { Die 'ההתקנה של Node הסתיימה אבל המערכת עדיין לא מזהה אותה. סגור את החלון, פתח PowerShell חדש, והרץ את הסקריפט שוב.' }
  Good "Node $(& node -v) הותקן"
}

# ---------- 2. Git ----------
Step 2 'בודק Git'
if (Have 'git') { Good 'Git מותקן' }
else {
  if (-not (Have 'winget')) { Die 'Git לא מותקן וגם winget לא זמין. התקן מ- https://git-scm.com ואז הרץ שוב.' }
  Info 'מתקין Git'
  & winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
  RefreshPath
  if (-not (Have 'git')) { Die 'ההתקנה של Git הסתיימה אבל המערכת לא מזהה אותה. סגור את החלון, פתח PowerShell חדש, והרץ שוב.' }
  Good 'Git הותקן'
}

# ---------- 3. הפרויקט ----------
Step 3 'מוריד את הפרויקט'
if (Test-Path (Join-Path $Root '.git')) {
  Info 'כבר קיים — מושך עדכונים'
  Set-Location $Root
  & git fetch origin $Branch 2>&1 | Out-Null
  & git checkout $Branch 2>&1 | Out-Null
  & git pull origin $Branch 2>&1 | Out-Null
  Good 'עודכן'
} else {
  if (Test-Path $Root) { Die "התיקייה $Root כבר קיימת אבל היא לא פרויקט Git. שנה את שמה או מחק אותה, והרץ שוב." }
  & git clone -b $Branch $RepoUrl $Root 2>&1 | Out-Null
  if (-not (Test-Path $Proj)) { Die 'ההורדה נכשלה. בדוק חיבור לאינטרנט והרץ שוב.' }
  Good "הורד אל $Root"
}
Set-Location $Proj

# ---------- 4. ספריות ----------
Step 4 'מתקין ספריות — 2 עד 5 דקות'
& npm install --no-audit --no-fund 2>&1 | ForEach-Object { if ($_ -match 'error|ERR!') { Write-Host "    $_" -ForegroundColor DarkGray } }
if ($LASTEXITCODE -ne 0) { Die 'התקנת הספריות נכשלה. גלול למעלה, העתק את השורות האדומות ושלח לי.' }
Good 'הותקנו'

# ---------- 5. דפדפן ----------
Step 5 'מוריד דפדפן ייעודי — כ-150 מגה'
& npx playwright install chromium 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'הורדת הדפדפן נכשלה. בדוק חיבור לאינטרנט והרץ שוב.' }
Good 'הורד'

# ---------- 6. בדיקות ----------
Step 6 'בודק שהלוגיקה תקינה'
& npm test 2>&1 | ForEach-Object { if ($_ -match 'נכשלו|עברו') { Write-Host "    $_" -ForegroundColor Gray } }
if ($LASTEXITCODE -ne 0) { Die 'בדיקות הלוגיקה נכשלו. זו בעיה בקוד, לא אצלך. שלח לי את החלון.' }
Good 'עברו'

Step 7 'בודק שהדפדפן והדרייבר תקינים — ייפתח חלון לרגע'
& npm run smoke 2>&1 | ForEach-Object { if ($_ -match 'נכשלו|עברו') { Write-Host "    $_" -ForegroundColor Gray } }
if ($LASTEXITCODE -ne 0) { Die 'בדיקת הדפדפן נכשלה. שלח לי את החלון — זו לא בעיית סלקטורים אלא משהו אחר.' }
Good 'תקין — כל כשל מכאן והלאה הוא סלקטור שהתיישן'

# ---------- 8. לקוח ----------
Step 8 'טוען את לקוח הדוגמה'
& node src/cli.js "client:add" clients/example.json
if ($LASTEXITCODE -ne 0) { Die 'טעינת הלקוח נכשלה.' }

# ---------- 9. ריצה ----------
Write-Host ''
Write-Host '════════════════════════════════════════' -ForegroundColor Yellow
Write-Host ' עכשיו הריצה האמיתית — 10 עד 15 דקות.' -ForegroundColor Yellow
Write-Host ''
Write-Host ' ייפתח חלון דפדפן. אל תיגע בו ואל תסגור אותו.' -ForegroundColor Yellow
Write-Host ' בין שאלה לשאלה יש המתנה שנראית כמו תקיעה — זה מכוון.' -ForegroundColor Yellow
Write-Host ' אם ChatGPT מבקש אימות אנושי, פתור אותו בחלון וזה ימשיך.' -ForegroundColor Yellow
Write-Host '════════════════════════════════════════' -ForegroundColor Yellow
Read-Host ' Enter כדי להתחיל'

$log = Join-Path $Proj 'run.log'
& node src/cli.js run goldfish --engine=chatgpt 2>&1 | Tee-Object -FilePath $log

Write-Host ''
Write-Host '════════════════════════════════════════' -ForegroundColor Green
Write-Host ' הריצה הסתיימה.' -ForegroundColor Green
Write-Host ''
Write-Host " שלח לי את הקובץ:  $log" -ForegroundColor White
$shots = Join-Path $Proj 'data\screenshots\1'
if (Test-Path $shots) { Write-Host " ואם היו שגיאות, גם צילום אחד מ: $shots" -ForegroundColor White }
Write-Host '════════════════════════════════════════' -ForegroundColor Green
try { Start-Process explorer.exe $Proj } catch {}
Read-Host ' Enter לסגירה'
