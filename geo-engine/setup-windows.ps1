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

<#
  הרצת תוכנית חיצונית.

  קריטי: ב-Windows PowerShell 5.1, כשמפנים 2>&1 מתוכנית חיצונית
  ו-ErrorActionPreference הוא Stop, כל שורה שהתוכנית כותבת לערוץ השגיאות
  הופכת לשגיאה קטלנית — גם כשהיא הודעת הצלחה תמימה.
  git fetch כותב "From https://..." לערוץ הזה בכל הרצה מוצלחת, ו-npm כותב
  אזהרות. לכן כאן מנמיכים זמנית ל-Continue, ובודקים הצלחה לפי קוד היציאה
  בלבד — שזו הדרך הנכונה ממילא.
#>
function Run($exe, [string[]]$argv, [switch]$Live) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = 0
  try {
    if ($Live) {
      & $exe @argv 2>&1 | ForEach-Object { Write-Host $_ }
      return @{ Code = $LASTEXITCODE; Out = '' }
    }
    $out = & $exe @argv 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
  } finally { $ErrorActionPreference = $old }
}

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
  Info ("node       : " + $(if (Have 'node')   { (Run 'node' @('-v')).Out.Trim() } else { 'לא מותקן' }))
  Info ("git        : " + $(if (Have 'git')    { 'מותקן' } else { 'לא מותקן' }))
  Info ("winget     : " + $(if (Have 'winget') { 'זמין' }  else { 'לא זמין' }))
  Info ("יומן       : " + $LogPath)

  # ---------- 1. Node ----------
  Step 1 'בודק Node.js'
  $nodeOk = $false
  if (Have 'node') {
    $v = (Run 'node' @('-v')).Out.Trim()
    if ($v -match 'v(\d+)\.') {
      if ([int]$Matches[1] -ge 20) { Good "Node $v תקין"; $nodeOk = $true }
      else { Info "Node $v ישן מדי, צריך 20 ומעלה" }
    }
  }
  if (-not $nodeOk) {
    if (-not (Have 'winget')) {
      Die 'Node.js חסר ו-winget לא זמין. התקן ידנית מ- https://nodejs.org/en/download ואז הרץ שוב.'
    }
    Info 'מתקין Node.js — כמה דקות, ייתכן שתתבקש לאשר'
    Run 'winget' @('install','--id','OpenJS.NodeJS.LTS','-e','--silent','--accept-source-agreements','--accept-package-agreements') | Out-Null
    RefreshPath
    if (-not (Have 'node')) {
      Die 'Node הותקן אבל החלון הנוכחי לא מזהה אותו. סגור את החלון והרץ שוב — בפעם השנייה זה יעבוד.'
    }
    Good ("Node " + (Run 'node' @('-v')).Out.Trim() + " הותקן")
  }

  # ---------- 2. Git ----------
  Step 2 'בודק Git'
  if (Have 'git') { Good 'Git מותקן' }
  else {
    if (-not (Have 'winget')) { Die 'Git חסר ו-winget לא זמין. התקן מ- https://git-scm.com ואז הרץ שוב.' }
    Info 'מתקין Git'
    Run 'winget' @('install','--id','Git.Git','-e','--silent','--accept-source-agreements','--accept-package-agreements') | Out-Null
    RefreshPath
    if (-not (Have 'git')) { Die 'Git הותקן אבל החלון לא מזהה אותו. סגור את החלון והרץ שוב.' }
    Good 'Git הותקן'
  }

  # ---------- 3. הפרויקט ----------
  Step 3 'מוריד את הפרויקט'
  if (Test-Path (Join-Path $Root '.git')) {
    Info 'קיים כבר — מושך עדכונים'
    Set-Location $Root
    $r = Run 'git' @('fetch','origin',$Branch)
    if ($r.Code -ne 0) { Die ("git fetch נכשל:`n" + $r.Out) }
    $r = Run 'git' @('checkout',$Branch)
    if ($r.Code -ne 0) { Die ("git checkout נכשל:`n" + $r.Out) }
    $r = Run 'git' @('reset','--hard',"origin/$Branch")
    if ($r.Code -ne 0) { Die ("git reset נכשל:`n" + $r.Out) }
    Good 'עודכן לגרסה האחרונה'
  } else {
    if (Test-Path $Root) { Die "התיקייה $Root קיימת אבל אינה פרויקט Git. שנה את שמה או מחק אותה והרץ שוב." }
    $r = Run 'git' @('clone','-b',$Branch,$RepoUrl,$Root)
    if ($r.Code -ne 0) { Die ("ההורדה נכשלה:`n" + $r.Out) }
    Good "הורד אל $Root"
  }
  if (-not (Test-Path $Proj)) { Die "לא נמצאה התיקייה $Proj" }
  Set-Location $Proj

  # ---------- 4. ספריות ----------
  Step 4 'מתקין ספריות — 2 עד 5 דקות'
  $r = Run 'npm' @('install','--no-audit','--no-fund')
  if ($r.Code -ne 0) { Die ("התקנת הספריות נכשלה:`n" + $r.Out) }
  Good 'הותקנו'

  # ---------- 5. דפדפן ----------
  Step 5 'מוריד דפדפן ייעודי — כ-150 מגה'
  $r = Run 'npx' @('playwright','install','chromium')
  if ($r.Code -ne 0) { Die ("הורדת הדפדפן נכשלה:`n" + $r.Out) }
  Good 'הורד'

  # ---------- 6-7. בדיקות ----------
  Step 6 'בודק את הלוגיקה'
  $r = Run 'npm' @('test')
  foreach ($line in ($r.Out -split "`r?`n")) { if ($line -match 'עברו|נכשלו') { Info $line.Trim() } }
  if ($r.Code -ne 0) { Die ("בדיקות הלוגיקה נכשלו:`n" + $r.Out) }
  Good 'עברו'

  Step 7 'בודק דפדפן ודרייבר — ייפתח חלון לרגע'
  $r = Run 'npm' @('run','smoke')
  foreach ($line in ($r.Out -split "`r?`n")) { if ($line -match 'עברו|נכשלו') { Info $line.Trim() } }
  if ($r.Code -ne 0) { Die ("בדיקת הדפדפן נכשלה:`n" + $r.Out) }
  Good 'תקין — מכאן, כל כשל הוא סלקטור שהתיישן'

  # ---------- 8. לקוח ----------
  Step 8 'טוען את לקוח הדוגמה'
  $r = Run 'node' @('src/cli.js','client:add','clients/example.json')
  if ($r.Code -ne 0) { Die ("טעינת הלקוח נכשלה:`n" + $r.Out) }
  Info $r.Out.Trim()

  # ---------- 9. קיצור דרך ----------
  # מכאן והלאה הכל נעשה מהממשק, ולכן צריך דבר אחד ללחוץ עליו.
  Step 9 'יוצר קיצור דרך על שולחן העבודה'
  # GEO.vbs פותח את התוכנה בלי חלון שחור. GEO.bat נשאר לאבחון תקלות.
  $Launcher = Join-Path $Proj 'GEO.vbs'
  if (-not (Test-Path $Launcher)) { $Launcher = Join-Path $Proj 'GEO.bat' }
  if (Test-Path $Launcher) {
    try {
      $Link = Join-Path ([Environment]::GetFolderPath('Desktop')) 'מנוע בדיקת נראות.lnk'
      $ws = New-Object -ComObject WScript.Shell
      $sc = $ws.CreateShortcut($Link)
      $sc.TargetPath       = $Launcher
      $sc.WorkingDirectory = $Proj
      $sc.Description      = 'בדיקת נראות עסקים במנועי AI'
      # אייקון של תוכנה ולא של סקריפט
      $sc.IconLocation     = "$env:SystemRoot\System32\shell32.dll,13"
      $sc.Save()
      Good 'נוצר: מנוע בדיקת נראות'
    } catch {
      Info 'לא הצלחתי ליצור קיצור. אפשר לפתוח ידנית את GEO.vbs בתיקיית הפרויקט.'
    }
  } else {
    Info 'המשגר לא נמצא בפרויקט.'
  }

  # ---------- 10. פתיחת הממשק ----------
  Write-Host ''
  Write-Host '════════════════════════════════════════' -ForegroundColor Green
  Write-Host ' ההתקנה הסתיימה. התוכנה נפתחת עכשיו.' -ForegroundColor Green
  Write-Host ' מכאן והלאה — לחיצה כפולה על' -ForegroundColor Green
  Write-Host ' "מנוע בדיקת נראות" בשולחן העבודה.' -ForegroundColor Green
  Write-Host ' בלי חלון שחור. לסגירה — כפתור בפינת המסך.' -ForegroundColor Green
  Write-Host '════════════════════════════════════════' -ForegroundColor Green
  Read-Host ' Enter כדי לפתוח'

  try { Start-Process -FilePath $Launcher -WorkingDirectory $Proj } catch {
    Info 'פתח ידנית את GEO.vbs בתיקיית הפרויקט.'
    try { Start-Process explorer.exe -ArgumentList $Proj } catch {}
  }

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
  Write-Host '  אם היו בעיות — שלח לי את הקובץ הזה:' -ForegroundColor White
  Write-Host ("  " + $LogPath) -ForegroundColor Yellow
  Write-Host ' ─────────────────────────────────────' -ForegroundColor White
  try { Start-Process explorer.exe -ArgumentList ('/select,"' + $LogPath + '"') } catch {}
  Write-Host ''
  Read-Host ' Enter לסגירה'
}
