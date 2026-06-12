$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$contentRoot = Join-Path $projectRoot "content"
$manifestPath = Join-Path $contentRoot "manifest.json"
$coursePath = Join-Path $contentRoot "course.json"
$claimsPath = Join-Path $contentRoot "claims.json"
$requiredFiles = @("theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md")
$allowedTypes = @("MCQ", "True/False", "Применение")
$errors = New-Object System.Collections.Generic.List[string]
$moduleCount = 0
$questionCount = 0
$autoCount = 0
$applicationCount = 0
$theoryTitles = @{}
$claimCoverageByModule = @{}
$claimFreshnessDays = 366
$requiredClaimModules = @("M08", "M09", "M10", "M11", "M17", "M19", "M20", "M21", "M22")

function Add-ContentError([string]$Message) {
  $script:errors.Add($Message) | Out-Null
}

function Test-IsoDate([string]$Value) {
  return $Value -match '^\d{4}-\d{2}-\d{2}$'
}

function Test-ReviewedAtFresh([string]$Value, [string]$Label) {
  try {
    $date = [datetime]::ParseExact($Value, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
  } catch {
    Add-ContentError "$Label reviewedAt must be a valid YYYY-MM-DD date"
    return
  }

  $today = (Get-Date).Date
  if ($date.Date -gt $today) {
    Add-ContentError "$Label reviewedAt is in the future: $Value"
  }
  if ($date.Date -lt $today.AddDays(-$script:claimFreshnessDays)) {
    Add-ContentError "$Label reviewedAt is stale: $Value"
  }
}

if (-not (Test-Path -LiteralPath $contentRoot)) {
  Add-ContentError "Missing content directory: $contentRoot"
} else {
  $modules = Get-ChildItem -LiteralPath $contentRoot -Directory | Sort-Object Name
  $moduleNames = @($modules | ForEach-Object { $_.Name })
  foreach ($module in $modules) {
    $moduleCount++
    if ($module.Name -notmatch '^M\d{2}$') {
      Add-ContentError "Unexpected module directory name: $($module.Name)"
    }

    foreach ($fileName in $requiredFiles) {
      $path = Join-Path $module.FullName $fileName
      if (-not (Test-Path -LiteralPath $path)) {
        Add-ContentError "Missing required file: $($module.Name)/$fileName"
      } else {
        $raw = Get-Content -Raw -LiteralPath $path -Encoding UTF8
        if ($raw -match '<[A-Za-z][^>]*>') {
          Add-ContentError "Raw HTML is not allowed: $($module.Name)/$fileName"
        }
      }
    }

    $theoryPath = Join-Path $module.FullName "theory.md"
    if (Test-Path -LiteralPath $theoryPath) {
      $theory = Get-Content -Raw -LiteralPath $theoryPath -Encoding UTF8
      $titleMatch = [regex]::Match($theory, "(?m)^#\s+$($module.Name)\s*[—-]\s+(.+?)\s*$")
      if (-not $titleMatch.Success) {
        Add-ContentError "Invalid or missing theory title: $($module.Name)/theory.md"
      } else {
        $theoryTitles[$module.Name] = $titleMatch.Groups[1].Value.Trim()
      }
    }

    $quizPath = Join-Path $module.FullName "quiz.md"
    if (Test-Path -LiteralPath $quizPath) {
      $quiz = Get-Content -Raw -LiteralPath $quizPath -Encoding UTF8
      $blocks = [regex]::Split($quiz, "\r?\n---+\r?\n")
      $moduleQuestions = 0
      $moduleAutoCount = 0
      $moduleApplicationCount = 0
      $seenQuestionNumbers = @{}

      foreach ($block in $blocks) {
        $head = [regex]::Match($block, "(?m)^##\s*Q(\d+)\s*\(([^)]+)\)\s*$")
        if (-not $head.Success) { continue }

        $moduleQuestions++
        $questionCount++
        $qNumber = [int]$head.Groups[1].Value
        $type = $head.Groups[2].Value.Trim()
        $body = $block.Substring($head.Index + $head.Length).Trim()
        $label = "$($module.Name)/quiz.md Q$qNumber"

        if ($seenQuestionNumbers.ContainsKey($qNumber)) {
          Add-ContentError "$label duplicates question number Q$qNumber"
        }
        $seenQuestionNumbers[$qNumber] = $true
        if ($qNumber -lt 1 -or $qNumber -gt 10) {
          Add-ContentError "$label question number must be in Q1..Q10"
        }

        if ($allowedTypes -notcontains $type) {
          Add-ContentError "$label uses unsupported type: $type"
          continue
        }

        if ($type -eq "MCQ") {
          $autoCount++
          $moduleAutoCount++
          $options = [regex]::Matches($body, "(?m)^([A-D])\.\s+(.+)$")
          if ($options.Count -lt 2) {
            Add-ContentError "$label has fewer than 2 MCQ options"
          }
          if ($options.Count -ne 4) {
            Add-ContentError "$label must have exactly 4 MCQ options"
          }

          $seenOptionLetters = @{}
          $seenOptionTexts = @{}
          foreach ($option in $options) {
            $letter = $option.Groups[1].Value
            $text = $option.Groups[2].Value.Trim().ToLowerInvariant()
            if ($seenOptionLetters.ContainsKey($letter)) {
              Add-ContentError "$label has duplicate MCQ option letter: $letter"
            }
            $seenOptionLetters[$letter] = $true
            if ($seenOptionTexts.ContainsKey($text)) {
              Add-ContentError "$label has duplicate MCQ option text: $($option.Groups[2].Value.Trim())"
            }
            $seenOptionTexts[$text] = $true
          }

          $answer = [regex]::Match($body, "\*\*Правильный ответ:\s*([A-D])\b[^*]*\*\*")
          if (-not $answer.Success) {
            Add-ContentError "$label is missing MCQ answer letter"
          } else {
            $answerKey = $answer.Groups[1].Value
            $hasOption = $false
            foreach ($option in $options) {
              if ($option.Groups[1].Value -eq $answerKey) { $hasOption = $true }
            }
            if (-not $hasOption) {
              Add-ContentError "$label answer '$answerKey' has no matching option"
            }
          }

          if ($body -notmatch "\*\*Объяснение:\*\*") {
            Add-ContentError "$label is missing explanation"
          }
        } elseif ($type -eq "True/False") {
          $autoCount++
          $moduleAutoCount++
          if ($body -notmatch "\*\*Правильный ответ:\s*(ВЕРНО|НЕВЕРНО|True|False)") {
            Add-ContentError "$label is missing True/False answer"
          }
          if ($body -notmatch "\*\*Объяснение:\*\*") {
            Add-ContentError "$label is missing explanation"
          }
        } elseif ($type -eq "Применение") {
          $applicationCount++
          $moduleApplicationCount++
          if ($body -notmatch "\*\*Ответ и разбор:\*\*") {
            Add-ContentError "$label is missing answer review block"
          }
        }
      }

      if ($moduleQuestions -ne 10) {
        Add-ContentError "$($module.Name)/quiz.md must have exactly 10 questions; found $moduleQuestions"
      }
      if ($moduleAutoCount -ne 7) {
        Add-ContentError "$($module.Name)/quiz.md must have exactly 7 automatic questions; found $moduleAutoCount"
      }
      if ($moduleApplicationCount -ne 3) {
        Add-ContentError "$($module.Name)/quiz.md must have exactly 3 application questions; found $moduleApplicationCount"
      }
      for ($expectedQuestion = 1; $expectedQuestion -le 10; $expectedQuestion++) {
        if (-not $seenQuestionNumbers.ContainsKey($expectedQuestion)) {
          Add-ContentError "$($module.Name)/quiz.md is missing Q$expectedQuestion"
        }
      }
    }
  }

  if (-not (Test-Path -LiteralPath $manifestPath)) {
    Add-ContentError "Missing content manifest: content/manifest.json"
  } else {
    try {
      $manifest = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
      if ($manifest.schemaVersion -ne 1) {
        Add-ContentError "content/manifest.json schemaVersion must be 1"
      }
      if ($manifest.claims -ne "content/claims.json") {
        Add-ContentError "content/manifest.json claims must be content/claims.json"
      }

      $manifestFiles = @($manifest.moduleFiles)
      foreach ($fileName in $requiredFiles) {
        if ($manifestFiles -notcontains $fileName) {
          Add-ContentError "content/manifest.json moduleFiles is missing: $fileName"
        }
      }
      foreach ($fileName in $manifestFiles) {
        if ($requiredFiles -notcontains $fileName) {
          Add-ContentError "content/manifest.json moduleFiles has unexpected file: $fileName"
        }
      }

      $manifestModules = @($manifest.modules)
      $manifestIds = @($manifestModules | ForEach-Object { $_.id })
      if ($manifestModules.Count -ne $moduleNames.Count) {
        Add-ContentError "content/manifest.json module count $($manifestModules.Count) does not match content directory count $($moduleNames.Count)"
      }

      $seenIds = @{}
      foreach ($item in $manifestModules) {
        $id = $item.id
        if ($id -notmatch '^M\d{2}$') {
          Add-ContentError "content/manifest.json has invalid module id: $id"
        }
        if ($seenIds.ContainsKey($id)) {
          Add-ContentError "content/manifest.json has duplicate module id: $id"
        }
        $seenIds[$id] = $true
        if ($moduleNames -notcontains $id) {
          Add-ContentError "content/manifest.json references missing module directory: $id"
        }
        $manifestTitle = if ($null -eq $item.title) { "" } else { [string]$item.title }
        if ([string]::IsNullOrWhiteSpace($manifestTitle)) {
          Add-ContentError "content/manifest.json module $id is missing title"
        } elseif ($theoryTitles.ContainsKey($id) -and $manifestTitle.Trim() -ne $theoryTitles[$id]) {
          Add-ContentError "content/manifest.json title for $id does not match theory title. Manifest: '$($manifestTitle.Trim())'. Theory: '$($theoryTitles[$id])'"
        }
      }
      foreach ($id in $moduleNames) {
        if ($manifestIds -notcontains $id) {
          Add-ContentError "content/manifest.json is missing module directory: $id"
        }
      }

      if (Test-Path -LiteralPath $coursePath) {
        $course = Get-Content -Raw -LiteralPath $coursePath -Encoding UTF8 | ConvertFrom-Json
        $courseIds = @($course.phases | ForEach-Object { $_.modules } | ForEach-Object { $_ })
        foreach ($id in $courseIds) {
          if ($manifestIds -notcontains $id) {
            Add-ContentError "content/course.json references module missing from manifest: $id"
          }
        }
        foreach ($id in $manifestIds) {
          if ($courseIds -notcontains $id) {
            Add-ContentError "content/manifest.json references module missing from course phases: $id"
          }
        }
      }
    } catch {
      Add-ContentError "Invalid content/manifest.json: $($_.Exception.Message)"
    }
  }

  if (-not (Test-Path -LiteralPath $claimsPath)) {
    Add-ContentError "Missing content claim contract: content/claims.json"
  } else {
    try {
      $claimsDoc = Get-Content -Raw -LiteralPath $claimsPath -Encoding UTF8 | ConvertFrom-Json
      if ($claimsDoc.schemaVersion -ne 1) {
        Add-ContentError "content/claims.json schemaVersion must be 1"
      }
      $claimsReviewedAt = [string]$claimsDoc.reviewedAt
      if (-not (Test-IsoDate $claimsReviewedAt)) {
        Add-ContentError "content/claims.json reviewedAt must be YYYY-MM-DD"
      } else {
        Test-ReviewedAtFresh $claimsReviewedAt "content/claims.json"
      }

      $sources = @($claimsDoc.sources)
      $sourceIds = @{}
      if ($sources.Count -eq 0) {
        Add-ContentError "content/claims.json must define at least one source"
      }
      foreach ($source in $sources) {
        $sourceId = if ($null -eq $source.sourceId) { "" } else { [string]$source.sourceId }
        $label = if ([string]::IsNullOrWhiteSpace($sourceId)) { "<missing sourceId>" } else { $sourceId }
        if ($sourceId -notmatch '^[A-Z0-9_]+$') {
          Add-ContentError "content/claims.json sourceId must use A-Z, 0-9, underscore: $label"
        }
        if ($sourceIds.ContainsKey($sourceId)) {
          Add-ContentError "content/claims.json has duplicate sourceId: $sourceId"
        }
        $sourceIds[$sourceId] = $true
        if ([string]::IsNullOrWhiteSpace([string]$source.title)) {
          Add-ContentError "content/claims.json source $label is missing title"
        }
        if ([string]::IsNullOrWhiteSpace([string]$source.jurisdiction)) {
          Add-ContentError "content/claims.json source $label is missing jurisdiction"
        }
        $sourceReviewedAt = [string]$source.reviewedAt
        if (-not (Test-IsoDate $sourceReviewedAt)) {
          Add-ContentError "content/claims.json source $label reviewedAt must be YYYY-MM-DD"
        } else {
          Test-ReviewedAtFresh $sourceReviewedAt "content/claims.json source $label"
        }
        if ([string]$source.url -notmatch '^https?://') {
          Add-ContentError "content/claims.json source $label url must be http(s)"
        }
      }

      $claims = @($claimsDoc.claims)
      $claimIds = @{}
      if ($claims.Count -eq 0) {
        Add-ContentError "content/claims.json must define at least one claim"
      }
      foreach ($claim in $claims) {
        $claimId = if ($null -eq $claim.claimId) { "" } else { [string]$claim.claimId }
        $label = if ([string]::IsNullOrWhiteSpace($claimId)) { "<missing claimId>" } else { $claimId }
        if ($claimId -notmatch '^[A-Z0-9_-]+$') {
          Add-ContentError "content/claims.json claimId must use A-Z, 0-9, underscore, dash: $label"
        }
        if ($claimIds.ContainsKey($claimId)) {
          Add-ContentError "content/claims.json has duplicate claimId: $claimId"
        }
        $claimIds[$claimId] = $true
        $claimModuleId = [string]$claim.moduleId
        if ($moduleNames -notcontains $claimModuleId) {
          Add-ContentError "content/claims.json claim $label references unknown moduleId: $($claim.moduleId)"
        } else {
          if (-not $script:claimCoverageByModule.ContainsKey($claimModuleId)) {
            $script:claimCoverageByModule[$claimModuleId] = 0
          }
          $script:claimCoverageByModule[$claimModuleId]++
        }
        if ([string]::IsNullOrWhiteSpace([string]$claim.kind)) {
          Add-ContentError "content/claims.json claim $label is missing kind"
        }
        if ([string]::IsNullOrWhiteSpace([string]$claim.claim)) {
          Add-ContentError "content/claims.json claim $label is missing claim text"
        }
        if ([string]::IsNullOrWhiteSpace([string]$claim.jurisdiction)) {
          Add-ContentError "content/claims.json claim $label is missing jurisdiction"
        }
        $claimReviewedAt = [string]$claim.reviewedAt
        if (-not (Test-IsoDate $claimReviewedAt)) {
          Add-ContentError "content/claims.json claim $label reviewedAt must be YYYY-MM-DD"
        } else {
          Test-ReviewedAtFresh $claimReviewedAt "content/claims.json claim $label"
        }

        $sourceId = if ($null -eq $claim.sourceId) { "" } else { [string]$claim.sourceId }
        if (-not $sourceIds.ContainsKey($sourceId)) {
          Add-ContentError "content/claims.json claim $label references unknown sourceId: $sourceId"
        }
        foreach ($supportingId in @($claim.supportingSourceIds)) {
          if (-not $sourceIds.ContainsKey([string]$supportingId)) {
            Add-ContentError "content/claims.json claim $label references unknown supportingSourceId: $supportingId"
          }
        }

        $claimFiles = @($claim.files)
        if ($claimFiles.Count -eq 0) {
          Add-ContentError "content/claims.json claim $label must list files"
        }
        foreach ($fileRef in $claimFiles) {
          $fileRefText = [string]$fileRef
          if ($fileRefText -notmatch '^content/M\d{2}/(theory|terms|quiz|practice|diagrams|summary)\.md$') {
            Add-ContentError "content/claims.json claim $label has invalid file reference: $fileRefText"
            continue
          }
          $absoluteFile = Join-Path $projectRoot $fileRefText
          if (-not (Test-Path -LiteralPath $absoluteFile)) {
            Add-ContentError "content/claims.json claim $label references missing file: $fileRefText"
          }
        }
      }
      foreach ($requiredModule in $requiredClaimModules) {
        if (($moduleNames -contains $requiredModule) -and -not $claimCoverageByModule.ContainsKey($requiredModule)) {
          Add-ContentError "content/claims.json required sensitive module has no claims: $requiredModule"
        }
      }
    } catch {
      Add-ContentError "Invalid content/claims.json: $($_.Exception.Message)"
    }
  }
}

if ($errors.Count -gt 0) {
  Write-Host "Content validation failed:" -ForegroundColor Red
  foreach ($err in $errors) { Write-Host "- $err" }
  exit 1
}

Write-Host "Content validation passed." -ForegroundColor Green
Write-Host "Modules: $moduleCount"
Write-Host "Questions: $questionCount ($autoCount automatic, $applicationCount application)"
if ($claimCoverageByModule.Count -gt 0) {
  $claimCoverage = $claimCoverageByModule.GetEnumerator() |
    Sort-Object Name |
    ForEach-Object { "$($_.Name)=$($_.Value)" }
  Write-Host "Claim coverage: $($claimCoverage -join ', ')"
  $uncoveredModules = @($moduleNames | Where-Object { -not $claimCoverageByModule.ContainsKey($_) })
  if ($uncoveredModules.Count -gt 0) {
    Write-Host "Claim coverage gaps: $($uncoveredModules -join ', ')" -ForegroundColor Yellow
  }
  Write-Host "Required claim modules: $($requiredClaimModules -join ', ')"
}
