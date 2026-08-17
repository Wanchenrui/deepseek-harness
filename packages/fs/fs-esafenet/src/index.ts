/**
 * Esafenet-compatible filesystem provider. Content operations cross a fixed
 * PowerShell bridge because protected workspaces may deny direct Node.js file
 * reads while allowing the approved PowerShell host. Model-controlled values
 * travel only as JSON on stdin; they never become commands or command-line
 * fragments.
 * @module @deepseek-ai/dsh-fs-esafenet
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { Buffer, constants as bufferConstants } from 'node:buffer'
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-fs-local'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsEditOutcome,
  FsEditRequest,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy, SandboxMode, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

/** Configuration for the fixed Esafenet content bridge. */
export interface Config extends LocalConfig {
  /** Hard timeout for one bridge operation. Defaults to 30 seconds. */
  operationTimeoutMs?: number
  /** Maximum text file size accepted by whole-text reads. Defaults to 16 MiB. */
  maxTextBytes?: number
  /** Process identity used by the fixed bridge. Windows defaults to a private `code.exe` alias. */
  processIdentity?: 'native' | 'code-alias'
}

/** Runtime schema for the Esafenet filesystem provider. */
export const Config: z<Config> = z.object({
  cwd: z.string().default(process.cwd()),
  diffBasisMaxBytes: z.number().default(10 * 1024 * 1024),
  operationTimeoutMs: z.number().default(30_000),
  maxTextBytes: z.number().default(16 * 1024 * 1024),
  processIdentity: z.union(['native', 'code-alias'] as const)
    .default(process.platform === 'win32' ? 'code-alias' : 'native'),
})

interface BridgeConfig {
  powershellPath: string
  powershellSize: number
  aliasBase?: string
  aliasDirectory?: string
  workingDirectory: string
  environment: NodeJS.ProcessEnv
  operationTimeoutMs: number
  maxTextBytes: number
}

interface BridgeRequest {
  operation: 'read' | 'write'
  path: string
  lexicalPath: string
  maxBytes?: number
  contentBase64?: string
  publish?: 'create' | 'replace'
  expectedContentBase64?: string
  allowedRoots?: string[]
}

type BridgeResponse =
  | { ok: true; contentBase64?: string; committed?: true; metadataPreserved?: boolean }
  | { ok: false; code: string; message: string }

const MAX_TIMER_MS = 2_147_483_647
const MAX_BRIDGE_CONTENT_BYTES = Math.min(
  64 * 1024 * 1024,
  bufferConstants.MAX_LENGTH,
  bufferConstants.MAX_STRING_LENGTH,
)
const MAX_BRIDGE_DIAGNOSTIC_BYTES = 256 * 1024

const POWERSHELL_BRIDGE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Throw-FsError {
  param([string]$Code, [string]$Message)
  $failure = [System.Exception]::new($Message)
  $failure.Data['FsCode'] = $Code
  throw $failure
}

function ConvertTo-JsonString {
  param([string]$Value)
  $builder = [Text.StringBuilder]::new()
  [void]$builder.Append('"')
  foreach ($character in $Value.ToCharArray()) {
    $code = [int]$character
    if ($code -eq 8) { [void]$builder.Append('\b'); continue }
    if ($code -eq 9) { [void]$builder.Append('\t'); continue }
    if ($code -eq 10) { [void]$builder.Append('\n'); continue }
    if ($code -eq 12) { [void]$builder.Append('\f'); continue }
    if ($code -eq 13) { [void]$builder.Append('\r'); continue }
    if ($code -eq 34) { [void]$builder.Append('\"'); continue }
    if ($code -eq 92) { [void]$builder.Append('\\'); continue }
    if ($code -lt 32) {
      [void]$builder.Append(('\u{0:x4}' -f $code))
    }
    else {
      [void]$builder.Append($character)
    }
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Write-BridgeResponse {
  param([hashtable]$Value)
  if ([bool]$Value.ok) {
    if ($Value.ContainsKey('contentBase64')) {
      $json = '{"ok":true,"contentBase64":' + (ConvertTo-JsonString ([string]$Value.contentBase64)) + '}'
    }
    else {
      $metadataPreserved = if ([bool]$Value.metadataPreserved) { 'true' } else { 'false' }
      $json = '{"ok":true,"committed":true,"metadataPreserved":' + $metadataPreserved + '}'
    }
  }
  else {
    $json = '{"ok":false,"code":' + (ConvertTo-JsonString ([string]$Value.code)) + ',"message":' + (ConvertTo-JsonString ([string]$Value.message)) + '}'
  }
  $payload = $utf8.GetBytes($json + [Environment]::NewLine)
  $stream = [Console]::OpenStandardOutput()
  $stream.Write($payload, 0, $payload.Length)
  $stream.Flush()
}

function Assert-NoReparsePoint {
  param([string]$Root, [string]$Path)
  $current = [IO.Path]::GetFullPath($Root)
  if (Test-Path -LiteralPath $current) {
    $rootItem = Get-Item -Force -LiteralPath $current
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      Throw-FsError 'FS_SANDBOX_DENIED' 'workspace root is a reparse point'
    }
  }
  $relative = [IO.Path]::GetFullPath($Path).Substring($current.Length).TrimStart([char[]]@('\', '/'))
  foreach ($segment in ($relative -split '[\\/]' | Where-Object { $_.Length -gt 0 })) {
    $current = Join-Path $current $segment
    if (-not (Test-Path -LiteralPath $current)) {
      continue
    }
    $item = Get-Item -Force -LiteralPath $current
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      Throw-FsError 'FS_SANDBOX_DENIED' 'reparse points are not admitted by the bridge'
    }
  }
}

function Assert-AllowedPath {
  param([string]$Path, [object[]]$AllowedRoots)
  $fullPath = [IO.Path]::GetFullPath($Path)
  $comparison = if ($env:OS -eq 'Windows_NT') {
    [StringComparison]::OrdinalIgnoreCase
  }
  else {
    [StringComparison]::Ordinal
  }
  foreach ($root in @($AllowedRoots)) {
    if ([string]::IsNullOrWhiteSpace([string]$root)) {
      continue
    }
    $fullRoot = [IO.Path]::GetFullPath([string]$root)
    $prefix = $fullRoot
    if (-not $prefix.EndsWith([string][IO.Path]::DirectorySeparatorChar)) {
      $prefix += [IO.Path]::DirectorySeparatorChar
    }
    if ($fullPath.Equals($fullRoot, $comparison) -or $fullPath.StartsWith($prefix, $comparison)) {
      Assert-NoReparsePoint $fullRoot $fullPath
      return $fullPath
    }
  }
  Throw-FsError 'FS_SANDBOX_DENIED' 'bridge path is outside the admitted roots'
}

function Read-BoundedContent {
  param([string]$Path, [int64]$MaxBytes)
  if ($MaxBytes -lt 0 -or $MaxBytes -gt ${MAX_BRIDGE_CONTENT_BYTES}) {
    Throw-FsError 'FS_TOO_LARGE' 'invalid bridge byte limit'
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    Throw-FsError 'FS_NOT_FOUND' 'file does not exist'
  }
  $item = Get-Item -Force -LiteralPath $Path
  if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
    Throw-FsError 'FS_NOT_REGULAR_FILE' 'path is not a regular file'
  }
  $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
  try {
    if ($stream.Length -gt $MaxBytes) {
      Throw-FsError 'FS_TOO_LARGE' 'file exceeds the configured byte limit'
    }
    $memory = [IO.MemoryStream]::new()
    try {
      $buffer = [byte[]]::new(64 * 1024)
      while ($memory.Length -le $MaxBytes) {
        $remaining = $MaxBytes + 1 - $memory.Length
        $count = [int][Math]::Min($buffer.Length, $remaining)
        $read = $stream.Read($buffer, 0, $count)
        if ($read -eq 0) {
          break
        }
        $memory.Write($buffer, 0, $read)
      }
      if ($memory.Length -gt $MaxBytes) {
        Throw-FsError 'FS_TOO_LARGE' 'file grew beyond the configured byte limit'
      }
      return ,$memory.ToArray()
    }
    finally {
      $memory.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

function Test-ContentEqual {
  param([byte[]]$Left, [byte[]]$Right)
  if ($Left.LongLength -ne $Right.LongLength) {
    return $false
  }
  for ($index = 0; $index -lt $Left.LongLength; $index++) {
    if ($Left[$index] -ne $Right[$index]) {
      return $false
    }
  }
  return $true
}

function Get-UnixModeNames {
  param([string]$Path)
  $method = [IO.File].GetMethods() | Where-Object {
    $_.Name -eq 'GetUnixFileMode' -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  if ($null -eq $method) {
    Throw-FsError 'FS_PERMISSION_DENIED' 'runtime cannot read the Unix publication mode'
  }
  return $method.Invoke($null, @($Path)).ToString()
}

function Set-UnixMode {
  param([string]$Path, [string]$ModeNames)
  $unixModeType = [Type]::GetType('System.IO.UnixFileMode, System.Private.CoreLib')
  if ($null -eq $unixModeType) {
    Throw-FsError 'FS_PERMISSION_DENIED' 'runtime cannot set the Unix publication mode'
  }
  $method = [IO.File].GetMethods() | Where-Object {
    $_.Name -eq 'SetUnixFileMode' -and $_.GetParameters().Count -eq 2
  } | Select-Object -First 1
  if ($null -eq $method) {
    Throw-FsError 'FS_PERMISSION_DENIED' 'runtime cannot set the Unix publication mode'
  }
  $mode = [Enum]::Parse($unixModeType, $ModeNames)
  $method.Invoke($null, @($Path, $mode)) | Out-Null
}

function Move-ReplacingFile {
  param([string]$Source, [string]$Destination)
  if ($env:OS -eq 'Windows_NT') {
    Move-Item -Force -LiteralPath $Source -Destination $Destination
    return
  }
  $method = [IO.File].GetMethods() | Where-Object {
    $_.Name -eq 'Move' -and $_.GetParameters().Count -eq 3
  } | Select-Object -First 1
  if ($null -eq $method) {
    Throw-FsError 'FS_IO_ERROR' 'runtime has no atomic replacement primitive'
  }
  $method.Invoke($null, @($Source, $Destination, $true)) | Out-Null
}

try {
  $requestText = [Console]::In.ReadToEnd()
  $request = $requestText | ConvertFrom-Json
  $lexicalPath = Assert-AllowedPath ([string]$request.lexicalPath) @($request.allowedRoots)
  $path = Assert-AllowedPath ([string]$request.path) @($request.allowedRoots)
  if ([string]::IsNullOrWhiteSpace($path)) {
    Throw-FsError 'FS_NOT_FOUND' 'bridge path must be non-empty'
  }

  switch ([string]$request.operation) {
    'read' {
      $maxBytes = [int64]$request.maxBytes
      [byte[]]$bytes = Read-BoundedContent $path $maxBytes
      Write-BridgeResponse @{ ok = $true; contentBase64 = [Convert]::ToBase64String($bytes) }
      break
    }
    'write' {
      $parent = Split-Path -Parent $path
      if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
        Throw-FsError 'FS_NOT_FOUND' 'target parent directory does not exist'
      }
      [byte[]]$bytes = [Convert]::FromBase64String([string]$request.contentBase64)
      $maxBytes = [int64]$request.maxBytes
      if ($bytes.LongLength -gt $maxBytes -or $maxBytes -gt ${MAX_BRIDGE_CONTENT_BYTES}) {
        Throw-FsError 'FS_TOO_LARGE' 'write content exceeds the configured byte limit'
      }
      $publish = [string]$request.publish
      if ($publish -eq 'replace') {
        [byte[]]$observed = Read-BoundedContent $path $maxBytes
        [byte[]]$expectedContent = [Convert]::FromBase64String([string]$request.expectedContentBase64)
        if (-not (Test-ContentEqual $observed $expectedContent)) {
          Throw-FsError 'FS_STALE_VERSION' 'target changed before publication'
        }
      }
      elseif ($publish -eq 'create') {
        if (Test-Path -LiteralPath $path) {
          Throw-FsError 'FS_NOT_OBSERVED' 'target appeared before publication'
        }
      }
      else {
        Throw-FsError 'FS_IO_ERROR' 'unsupported publication mode'
      }

      $temp = Join-Path $parent ('.dsh-esafenet-' + [Guid]::NewGuid().ToString('N') + '.tmp')
      $committed = $false
      $caught = $null
      $publicationUnixMode = $null
      $metadataPreserved = $true
      try {
        if ($env:OS -eq 'Windows_NT') {
          if ($publish -eq 'replace') {
            $publicationSecurity = [IO.File]::GetAccessControl($path)
          }
          $writer = [IO.FileStream]::new(
            $temp,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            64 * 1024,
            [IO.FileOptions]::WriteThrough
          )
          if ($publish -eq 'create') {
            $publicationSecurity = [IO.File]::GetAccessControl($temp)
          }
          $privateSecurity = [Security.AccessControl.FileSecurity]::new()
          $privateSecurity.SetAccessRuleProtection($true, $false)
          $fileIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User
          $fileRule = [Security.AccessControl.FileSystemAccessRule]::new(
            $fileIdentity,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow
          )
          $privateSecurity.AddAccessRule($fileRule)
          [IO.File]::SetAccessControl($temp, $privateSecurity)
        }
        else {
          if ($publish -eq 'replace') {
            $publicationUnixMode = Get-UnixModeNames $path
          }
          $writer = [IO.FileStream]::new(
            $temp,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            64 * 1024,
            [IO.FileOptions]::WriteThrough
          )
          if ($publish -eq 'create') {
            $publicationUnixMode = Get-UnixModeNames $temp
          }
          Set-UnixMode $temp 'UserRead,UserWrite'
        }
        try {
          $writer.Write($bytes, 0, $bytes.Length)
          $writer.Flush($true)
        }
        finally {
          $writer.Dispose()
        }

        Assert-AllowedPath $lexicalPath @($request.allowedRoots) | Out-Null
        Assert-AllowedPath $path @($request.allowedRoots) | Out-Null

        if ($publish -eq 'replace') {
          [byte[]]$current = Read-BoundedContent $path $maxBytes
          if (-not (Test-ContentEqual $current $expectedContent)) {
            Throw-FsError 'FS_STALE_VERSION' 'target changed before publication'
          }
          Move-ReplacingFile $temp $path
        }
        else {
          try {
            [IO.File]::Move($temp, $path)
          }
          catch [IO.IOException] {
            if (Test-Path -LiteralPath $path) {
              Throw-FsError 'FS_NOT_OBSERVED' 'target appeared before publication'
            }
            throw
          }
        }
        $committed = $true
        try {
          if ($env:OS -ne 'Windows_NT') {
            Set-UnixMode $path $publicationUnixMode
          }
          else {
            [IO.File]::SetAccessControl($path, $publicationSecurity)
          }
        }
        catch {
          # 内容已经发布；保留仅所有者权限并在提交回执中显式降级，避免不安全重试。
          $metadataPreserved = $false
        }
      }
      catch {
        $caught = $_
      }
      finally {
        try {
          if (Test-Path -LiteralPath $temp) {
            $tempItem = Get-Item -Force -LiteralPath $temp
            if (($tempItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
              Remove-Item -Force -LiteralPath $temp
            }
          }
        }
        catch {
          if (-not $committed -and $null -eq $caught) {
            $caught = $_
          }
        }
      }
      if ($committed) {
        Write-BridgeResponse @{ ok = $true; committed = $true; metadataPreserved = $metadataPreserved }
      }
      elseif ($null -ne $caught) {
        throw $caught
      }
      else {
        Throw-FsError 'FS_IO_ERROR' 'publication failed before commit'
      }
      break
    }
    default {
      Throw-FsError 'FS_IO_ERROR' 'unsupported bridge operation'
    }
  }
}
catch {
  $code = if ($_.Exception.Data.Contains('FsCode')) {
    [string]$_.Exception.Data['FsCode']
  }
  elseif ($_.Exception -is [System.UnauthorizedAccessException]) {
    'FS_PERMISSION_DENIED'
  }
  elseif ($_.Exception -is [System.IO.FileNotFoundException] -or $_.Exception -is [System.IO.DirectoryNotFoundException]) {
    'FS_NOT_FOUND'
  }
  else {
    'FS_IO_ERROR'
  }
  Write-BridgeResponse @{ ok = $false; code = $code; message = [string]$_.Exception.Message }
}
`

const POWERSHELL_BRIDGE_COMMAND = Buffer.from(
  POWERSHELL_BRIDGE_SCRIPT.split('\n').map(line => line.trim()).filter(Boolean).join('\n'),
  'utf16le',
).toString('base64')

function fixedPowerShellPath(): string {
  const candidates = process.platform === 'win32'
    ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]
    : ['/usr/bin/pwsh', '/usr/local/bin/pwsh', '/opt/microsoft/powershell/7/pwsh']
  const selected = candidates.find(candidate => isAbsolute(candidate) && existsSync(candidate) && statSync(candidate).isFile())
  if (selected === undefined) {
    throw new Error('fs-esafenet: no approved absolute PowerShell executable is installed')
  }
  return realpathSync.native(selected)
}

function pathContains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function createCodeAlias(source: string, workspaceRoot: string): { executable: string; directory: string; base: string } {
  if (process.platform !== 'win32') {
    throw new Error('fs-esafenet: code-alias process identity is supported only on Windows')
  }
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData === undefined || !isAbsolute(localAppData)) {
    throw new Error('fs-esafenet: LOCALAPPDATA must be an absolute path for code-alias identity')
  }
  const base = join(localAppData, 'DeepSeekHarness', 'esafenet-bridge')
  mkdirSync(base, { recursive: true })
  const canonicalBase = realpathSync.native(base)
  let canonicalWorkspace = resolve(workspaceRoot)
  try {
    canonicalWorkspace = realpathSync.native(canonicalWorkspace)
  }
  catch {
    // 缺失的 workspace 不能获得别名目录；词法路径仍用于保守拒绝。
  }
  if (pathContains(canonicalWorkspace, canonicalBase) || pathContains(canonicalBase, canonicalWorkspace)) {
    throw new Error('fs-esafenet: code-alias directory must be isolated from the workspace')
  }
  const directory = mkdtempSync(join(canonicalBase, 'run-'))
  const executable = join(directory, 'code.exe')
  copyFileSync(source, executable, fsConstants.COPYFILE_EXCL)
  if (!statSync(executable).isFile() || statSync(executable).size !== statSync(source).size) {
    throw new Error('fs-esafenet: private code.exe alias was not copied completely')
  }
  return { executable, directory, base: canonicalBase }
}

function removeCodeAlias(base: string | undefined, directory: string | undefined, executable: string): void {
  if (base === undefined || directory === undefined) return
  const parent = resolve(dirname(directory)).toLowerCase()
  if (!isAbsolute(base)
    || parent !== resolve(base).toLowerCase()
    || resolve(dirname(executable)).toLowerCase() !== resolve(directory).toLowerCase()
    || !/^run-[A-Za-z0-9]{6}$/u.test(basename(directory))) {
    throw new Error('fs-esafenet: refused to remove an unowned code-alias directory')
  }
  if (existsSync(executable)) unlinkSync(executable)
  if (existsSync(directory)) rmdirSync(directory)
}

function positiveBoundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`fs-esafenet: ${name} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

function bridgeProcessEnvironment(powershellPath: string): Pick<BridgeConfig, 'workingDirectory' | 'environment'> {
  if (process.platform === 'win32') {
    const systemRoot = resolve(dirname(powershellPath), '..', '..', '..')
    const system32 = join(systemRoot, 'System32')
    const temporary = process.env.TEMP ?? process.env.TMP ?? tmpdir()
    return {
      workingDirectory: system32,
      environment: {
        OS: 'Windows_NT',
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        ComSpec: join(system32, 'cmd.exe'),
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        USERPROFILE: process.env.USERPROFILE,
        PSModulePath: join(system32, 'WindowsPowerShell', 'v1.0', 'Modules'),
        TEMP: temporary,
        TMP: temporary,
        PATH: `${system32};${systemRoot}`,
      },
    }
  }
  return {
    workingDirectory: '/',
    environment: {
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? 'C.UTF-8',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
    },
  }
}

function strictBase64(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return undefined
  }
  const decoded = Buffer.from(value, 'base64')
  return decoded.toString('base64') === value ? decoded : undefined
}

class BridgeTransportError extends FsError {
  readonly publicationUnknown: boolean

  constructor(message: string, code: 'FS_ABORTED' | 'FS_IO_ERROR' | 'FS_TOO_LARGE', publicationUnknown: boolean, options?: ErrorOptions) {
    super(message, code, options)
    this.publicationUnknown = publicationUnknown
  }
}

function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n')
}

function decodeUtf8Text(bytes: Uint8Array, displayPath: string): string {
  if (bytes.includes(0)) {
    throw new FsError(`cannot read "${displayPath}": binary file`, 'FS_NOT_TEXT')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error
    throw new FsError(`cannot read "${displayPath}": invalid UTF-8`, 'FS_NOT_TEXT', { cause: error })
  }
}

function lineEndingsOf(content: string): 'LF' | 'CRLF' {
  const sample = content.slice(0, 4096)
  const crlf = sample.split('\r\n').length - 1
  const lf = sample.split('\n').length - 1 - crlf
  return crlf > lf ? 'CRLF' : 'LF'
}

function restoreLineEndings(content: string, lineEndings: 'LF' | 'CRLF'): string {
  return lineEndings === 'LF' ? content : normalizeLineEndings(content).split('\n').join('\r\n')
}

function applyLiteralEdit(content: string, edit: FsEditRequest, displayPath: string): string {
  const oldString = normalizeLineEndings(edit.oldString)
  if (oldString.length === 0) {
    throw new FsError('old_string must be a non-empty string', 'FS_EDIT_NOT_FOUND')
  }
  const newString = normalizeLineEndings(edit.newString)
  const matches = content.split(oldString).length - 1
  if (matches === 0) {
    throw new FsError(`old_string was not found in "${displayPath}"`, 'FS_EDIT_NOT_FOUND')
  }
  if (!edit.replaceAll && matches > 1) {
    throw new FsError(`old_string matched ${matches} times in "${displayPath}"`, 'FS_AMBIGUOUS_EDIT')
  }
  return edit.replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString)
}

function fsError(code: string, message: string): FsError {
  const known = new Set([
    'FS_NOT_FOUND',
    'FS_NOT_DIRECTORY',
    'FS_NOT_TEXT',
    'FS_NOT_REGULAR_FILE',
    'FS_TOO_LARGE',
    'FS_PERMISSION_DENIED',
    'FS_SANDBOX_DENIED',
    'FS_IO_ERROR',
    'FS_STALE_VERSION',
    'FS_NOT_OBSERVED',
    'FS_AMBIGUOUS_EDIT',
    'FS_EDIT_NOT_FOUND',
    'FS_ABORTED',
  ])
  return new FsError(message, known.has(code) ? code as FsError['code'] : 'FS_IO_ERROR')
}

/**
 * Fixed PowerShell bridge over the local filesystem seam. Metadata and target
 * identity stay with the existing local provider; only protected content I/O
 * crosses the approved process boundary.
 */
export class EsafenetFileSystem extends LocalFileSystem {
  static inject = ['sandboxPolicy', 'sandbox']
  static override Config = Config

  private readonly bridge: BridgeConfig
  private readonly defaultMode: SandboxMode
  private readonly mutationLocks = new Map<string, Promise<unknown>>()
  private readonly bridgeChildren = new Set<ChildProcessWithoutNullStreams>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, config)
    const operationTimeoutMs = positiveBoundedInteger(
      config.operationTimeoutMs ?? 30_000,
      'operationTimeoutMs',
      MAX_TIMER_MS,
    )
    const maxTextBytes = positiveBoundedInteger(
      config.maxTextBytes ?? 16 * 1024 * 1024,
      'maxTextBytes',
      MAX_BRIDGE_CONTENT_BYTES,
    )
    this.defaultMode = ctx.sandboxPolicy.defaultMode
    const nativePowerShellPath = fixedPowerShellPath()
    const processEnvironment = bridgeProcessEnvironment(nativePowerShellPath)
    const identity = config.processIdentity ?? (process.platform === 'win32' ? 'code-alias' : 'native')
    const alias = identity === 'code-alias'
      ? createCodeAlias(nativePowerShellPath, config.cwd ?? process.cwd())
      : undefined
    const powershellPath = alias?.executable ?? nativePowerShellPath
    try {
      this.bridge = {
        powershellPath,
        powershellSize: statSync(nativePowerShellPath).size,
        ...(alias === undefined ? {} : { aliasBase: alias.base, aliasDirectory: alias.directory }),
        ...processEnvironment,
        operationTimeoutMs,
        maxTextBytes,
      }
      ctx.effect(() => () => {
        for (const child of this.bridgeChildren) void child.kill()
        this.bridgeChildren.clear()
        try {
          removeCodeAlias(this.bridge.aliasBase, this.bridge.aliasDirectory, this.bridge.powershellPath)
        }
        catch (error: unknown) {
          ctx.logger.warn('fs-esafenet: private code.exe alias cleanup failed', error)
        }
      })
    }
    catch (error: unknown) {
      removeCodeAlias(alias?.base, alias?.directory, powershellPath)
      throw error
    }
  }

  /** Deployment sandbox default advertised to model-facing filesystem tools. */
  override get sandboxMode(): SandboxMode {
    return this.defaultMode
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    const bytes = await this.readBridgeBytes(target, this.bridge.maxTextBytes, signal)
    return decodeUtf8Text(bytes, target.displayPath)
  }

  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const content = await this.readText(target, signal)
    function* chunks(): Iterable<string> {
      const chunkCharacters = 64 * 1024
      for (let index = 0; index < content.length; index += chunkCharacters) {
        if (signal?.aborted) throw new FsError('read aborted', 'FS_ABORTED')
        yield content.slice(index, index + chunkCharacters)
      }
    }
    return Readable.from(chunks())
  }

  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.readBridgeBytes(
      target,
      positiveBoundedInteger(maxBytes, 'maxBytes', MAX_BRIDGE_CONTENT_BYTES),
      signal,
    )
  }

  /**
   * Publish UTF-8 text through the fixed bridge after sandbox and freshness
   * checks.
   * @param target - canonical filesystem target to create or replace.
   * @param content - complete UTF-8 text to publish.
   * @param expected - optional create or version guard.
   * @param signal - cancels the bridge operation before publication completes.
   * @param sandboxPolicy - per-call sandbox authority; the deployment policy is used when omitted.
   * @returns the published version and provider-neutral diff basis.
   */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    const { target: checked, policy } = await this.checkedTarget(target, sandboxPolicy)
    return this.withMutationLock(checked.targetKey, async () => {
      this.throwIfAborted(signal, 'write')
      const existing = await super.stat(checked, signal)
      if (existing && existing.type !== 'file') {
        throw new FsError(`cannot write "${checked.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (expected?.kind === 'replaceIfVersion') {
        if (!existing || existing.version !== expected.version) {
          throw new FsError(`cannot write "${checked.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
        }
      }
      else if (expected?.kind === 'createIfAbsent' && existing) {
        throw new FsError(`cannot overwrite existing "${checked.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
      }

      const contentBytes = Buffer.from(content, 'utf8')
      if (contentBytes.length > this.bridge.maxTextBytes) {
        throw new FsError(
          `cannot write "${checked.displayPath}": content exceeds ${this.bridge.maxTextBytes} bytes`,
          'FS_TOO_LARGE',
        )
      }
      const diffLimit = this.config.diffBasisMaxBytes
      let before: string | null = null
      let expectedContentBase64: string | undefined
      if (existing) {
        const observed = await this.readBridgeBytes(checked, this.bridge.maxTextBytes, signal, policy)
        const confirmed = await super.stat(checked, signal)
        if (!confirmed || confirmed.type !== 'file' || confirmed.version !== existing.version) {
          throw new FsError(`cannot write "${checked.displayPath}": file changed while it was read`, 'FS_STALE_VERSION')
        }
        expectedContentBase64 = Buffer.from(observed).toString('base64')
        if (observed.length < diffLimit && contentBytes.length < diffLimit) {
          try {
            before = normalizeLineEndings(decodeUtf8Text(observed, checked.displayPath))
          }
          catch (error: unknown) {
            if (error instanceof FsError && error.code !== 'FS_NOT_TEXT') throw error
          }
        }
      }
      await this.publishBridge(
        checked,
        contentBytes,
        existing ? 'replace' : 'create',
        expectedContentBase64,
        signal,
        policy,
      )
      return {
        operation: existing ? 'update' : 'create',
        version: await this.versionAfterCommit(checked),
        before,
        after: normalizeLineEndings(content),
      }
    })
  }

  /**
   * Apply one literal edit through a serialized read-match-publish sequence.
   * @param target - canonical regular-file target to edit.
   * @param edit - literal replacement request.
   * @param expected - optional version guard checked before matching.
   * @param signal - cancels the bridge operation before publication completes.
   * @param sandboxPolicy - per-call sandbox authority; the deployment policy is used when omitted.
   * @returns the new version and normalized before/after text.
   */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    const { target: checked, policy } = await this.checkedTarget(target, sandboxPolicy)
    return this.withMutationLock(checked.targetKey, async () => {
      this.throwIfAborted(signal, 'edit')
      const existing = await super.stat(checked, signal)
      if (!existing) {
        throw new FsError(`cannot edit "${checked.displayPath}": file no longer exists`, 'FS_STALE_VERSION')
      }
      if (existing.type !== 'file') {
        throw new FsError(`cannot edit "${checked.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (expected && expected.version !== existing.version) {
        throw new FsError(`cannot edit "${checked.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
      const observed = await this.readBridgeBytes(checked, this.bridge.maxTextBytes, signal, policy)
      const confirmed = await super.stat(checked, signal)
      if (!confirmed || confirmed.type !== 'file' || confirmed.version !== existing.version) {
        throw new FsError(`cannot edit "${checked.displayPath}": file changed while it was read`, 'FS_STALE_VERSION')
      }
      const raw = decodeUtf8Text(observed, checked.displayPath)
      const lineEndings = lineEndingsOf(raw)
      const before = normalizeLineEndings(raw)
      const after = applyLiteralEdit(before, edit, checked.displayPath)
      const contentBytes = Buffer.from(restoreLineEndings(after, lineEndings), 'utf8')
      if (contentBytes.length > this.bridge.maxTextBytes) {
        throw new FsError(
          `cannot edit "${checked.displayPath}": content exceeds ${this.bridge.maxTextBytes} bytes`,
          'FS_TOO_LARGE',
        )
      }
      await this.publishBridge(
        checked,
        contentBytes,
        'replace',
        Buffer.from(observed).toString('base64'),
        signal,
        policy,
      )
      return { version: await this.versionAfterCommit(checked), before, after }
    })
  }

  private async checkedTarget(
    target: FsTarget,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<{ target: FsTarget; policy: SandboxPolicy }> {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
    if (policy.mode === 'danger-full-access') {
      throw new FsError('fs-esafenet refuses danger-full-access mutations', 'FS_SANDBOX_DENIED')
    }
    if (policy.mode === 'read-only') {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED')
    }
    const confinedPolicy = policy as SandboxPolicy
    const fresh = await this.resolve(target.displayPath)
    const resolvedRoot = await this.resolve(confinedPolicy.workspaceRoot)
    if (this.contains(resolvedRoot, fresh)) return { target: fresh, policy: confinedPolicy }
    throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED')
  }

  private async publishBridge(
    target: FsTarget,
    content: Buffer,
    publish: 'create' | 'replace',
    expectedContentBase64: string | undefined,
    signal: AbortSignal | undefined,
    policy: SandboxPolicy,
  ): Promise<void> {
    try {
      const response = await this.runBridge({
        operation: 'write',
        path: this.processPath(target),
        lexicalPath: target.displayPath,
        maxBytes: this.bridge.maxTextBytes,
        contentBase64: content.toString('base64'),
        publish,
        ...(expectedContentBase64 === undefined ? {} : { expectedContentBase64 }),
      }, signal, 1024 * 1024, policy)
      if (response.committed !== true) {
        throw new BridgeTransportError(
          'Esafenet PowerShell bridge omitted its commit receipt',
          'FS_IO_ERROR',
          true,
        )
      }
      if (response.metadataPreserved === false) {
        this.ctx.logger.warn('fs-esafenet: content committed with private publication metadata')
      }
    }
    catch (error: unknown) {
      if (!(error instanceof BridgeTransportError) || !error.publicationUnknown) throw error
      try {
        const observed = await this.readBridgeBytes(target, this.bridge.maxTextBytes, undefined, policy)
        if (Buffer.from(observed).equals(content)) return
      }
      catch {
        // 传输中断后的只读核对失败不能覆盖原始错误；调用者仍得到“提交状态未知”。
      }
      throw error
    }
  }

  private async readBridgeBytes(
    target: FsTarget,
    maxBytes: number,
    signal?: AbortSignal,
    policy: SandboxPolicy = { mode: 'read-only', workspaceRoot: this.config.cwd },
  ): Promise<Uint8Array> {
    const response = await this.runBridge({
      operation: 'read',
      path: this.processPath(target),
      lexicalPath: target.displayPath,
      maxBytes,
    }, signal, Math.ceil(maxBytes / 3) * 4 + 16 * 1024, policy)
    const bytes = strictBase64(response.contentBase64)
    if (bytes === undefined) {
      throw new FsError('Esafenet PowerShell bridge returned invalid Base64 content', 'FS_IO_ERROR')
    }
    if (bytes.length > maxBytes) {
      throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, 'FS_TOO_LARGE')
    }
    return bytes
  }

  private async versionAfterCommit(target: FsTarget): Promise<FsVersion> {
    try {
      const info = await super.stat(target)
      if (info?.type === 'file') return info.version
    }
    catch {
      // 内容桥已给出提交回执；元数据故障不能把成功写入伪装成未提交。
    }
    return FsVersion(`committed:${String(target.targetKey)}`)
  }

  private runBridge(
    request: BridgeRequest,
    signal: AbortSignal | undefined,
    maxOutputBytes: number,
    policy: SandboxPolicy,
  ): Promise<Extract<BridgeResponse, { ok: true }>> {
    this.throwIfAborted(signal, request.operation)
    if (!existsSync(this.bridge.powershellPath)
      || !statSync(this.bridge.powershellPath).isFile()
      || statSync(this.bridge.powershellPath).size !== this.bridge.powershellSize) {
      throw new FsError('Esafenet bridge executable changed after provider setup', 'FS_IO_ERROR')
    }
    const allowedRoots = [policy.workspaceRoot]
    const wireRequest: BridgeRequest = { ...request, allowedRoots }
    const confined = this.ctx.sandbox.confine([
      this.bridge.powershellPath,
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      POWERSHELL_BRIDGE_COMMAND,
    ], policy)
    if (confined.enforcement !== 'full' && process.platform !== 'win32') {
      throw new FsError('Esafenet PowerShell bridge requires full sandbox enforcement', 'FS_SANDBOX_DENIED')
    }
    const executable = confined.argv[0]
    if (executable === undefined) {
      throw new FsError('Esafenet sandbox returned an empty runner argv', 'FS_IO_ERROR')
    }
    return new Promise((resolve, reject) => {
      const child = spawn(executable, confined.argv.slice(1), {
        cwd: this.bridge.workingDirectory,
        env: this.bridge.environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.bridgeChildren.add(child)
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let settled = false
      let timedOut = false
      let aborted = false
      let overflow = false
      let escalation: NodeJS.Timeout | undefined
      let responseReceived = false
      let responseCompletion: (() => void) | undefined

      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (escalation !== undefined) clearTimeout(escalation)
        signal?.removeEventListener('abort', onAbort)
        operation()
      }
      const terminate = (): void => {
        void child.kill()
        escalation ??= setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) void child.kill('SIGKILL')
        }, 250)
        escalation.unref()
      }
      const onAbort = (): void => {
        aborted = true
        terminate()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        terminate()
      }, this.bridge.operationTimeoutMs)

      const completeAfterClose = (operation: () => void): void => {
        if (settled || responseReceived) return
        responseReceived = true
        responseCompletion = operation
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        terminate()
      }

      const completeFromOutput = (output: string): void => {
        let parsed: unknown
        try {
          parsed = JSON.parse(output)
        }
        catch (error: unknown) {
          completeAfterClose(() => {
            reject(new BridgeTransportError(
              'Esafenet PowerShell bridge returned invalid JSON',
              'FS_IO_ERROR',
              request.operation === 'write',
              { cause: error },
            ))
          })
          return
        }
        if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
          completeAfterClose(() => {
            reject(new BridgeTransportError(
              'Esafenet PowerShell bridge returned an invalid response shape',
              'FS_IO_ERROR',
              request.operation === 'write',
            ))
          })
          return
        }
        const response = parsed as Record<string, unknown>
        if (response.ok === false) {
          if (typeof response.code !== 'string' || typeof response.message !== 'string') {
            completeAfterClose(() => {
              reject(new BridgeTransportError(
                'Esafenet PowerShell bridge returned an invalid error shape',
                'FS_IO_ERROR',
                request.operation === 'write',
              ))
            })
          }
          else {
            completeAfterClose(() => {
              reject(fsError(response.code as string, response.message as string))
            })
          }
          return
        }
        if (response.ok !== true) {
          completeAfterClose(() => {
            reject(new BridgeTransportError(
              'Esafenet PowerShell bridge returned a non-boolean status',
              'FS_IO_ERROR',
              request.operation === 'write',
            ))
          })
          return
        }
        if (request.operation === 'read' && typeof response.contentBase64 !== 'string') {
          completeAfterClose(() => {
            reject(new BridgeTransportError(
              'Esafenet PowerShell bridge omitted read content',
              'FS_IO_ERROR',
              false,
            ))
          })
          return
        }
        if (request.operation === 'write' && response.committed !== true) {
          completeAfterClose(() => {
            reject(new BridgeTransportError(
              'Esafenet PowerShell bridge omitted its commit receipt',
              'FS_IO_ERROR',
              true,
            ))
          })
          return
        }
        if (request.operation === 'write' && typeof response.metadataPreserved !== 'boolean') {
          completeAfterClose(() => {
            reject(new BridgeTransportError(
              'Esafenet PowerShell bridge omitted its metadata receipt',
              'FS_IO_ERROR',
              true,
            ))
          })
          return
        }
        completeAfterClose(() => {
          resolve(response as Extract<BridgeResponse, { ok: true }>)
        })
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        if (stdoutBytes > maxOutputBytes) {
          overflow = true
          terminate()
          return
        }
        stdout.push(chunk)
        if (!settled && !responseReceived && !aborted && !timedOut && !overflow && chunk.includes(0x0a)) {
          completeFromOutput(Buffer.concat(stdout).toString('utf8').trim())
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length
        if (stderrBytes > MAX_BRIDGE_DIAGNOSTIC_BYTES) {
          overflow = true
          terminate()
          return
        }
        stderr.push(chunk)
      })
      child.stdin.on('error', (error) => {
        finish(() => {
          reject(new BridgeTransportError(
            `Esafenet PowerShell bridge rejected its fixed request: ${error.message}`,
            'FS_IO_ERROR',
            request.operation === 'write',
            { cause: error },
          ))
        })
      })
      child.once('error', (error) => {
        finish(() => {
          reject(new BridgeTransportError(
            `Esafenet PowerShell bridge failed to start: ${error.message}`,
            'FS_IO_ERROR',
            false,
            { cause: error },
          ))
        })
      })
      child.once('close', (code) => {
        this.bridgeChildren.delete(child)
        if (escalation !== undefined) clearTimeout(escalation)
        if (settled) return
        if (responseCompletion !== undefined) {
          finish(responseCompletion)
          return
        }
        const output = Buffer.concat(stdout).toString('utf8').trim()
        if (!aborted && !timedOut && !overflow && output.length > 0) {
          completeFromOutput(output)
          return
        }
        finish(() => {
          if (aborted) {
            reject(new BridgeTransportError(
              `${request.operation} aborted`,
              'FS_ABORTED',
              request.operation === 'write',
            ))
            return
          }
          if (timedOut) {
            reject(new BridgeTransportError(
              `Esafenet PowerShell bridge timed out after ${this.bridge.operationTimeoutMs} ms`,
              'FS_IO_ERROR',
              request.operation === 'write',
            ))
            return
          }
          if (overflow) {
            reject(new BridgeTransportError(
              'Esafenet PowerShell bridge output exceeded its bounded response',
              'FS_TOO_LARGE',
              request.operation === 'write',
            ))
            return
          }
          const detail = Buffer.concat(stderr).toString('utf8').trim()
          reject(new BridgeTransportError(
            `Esafenet PowerShell bridge exited (${String(code)}) without a valid response${detail ? `: ${detail}` : ''}`,
            'FS_IO_ERROR',
            request.operation === 'write',
          ))
        })
      })
      child.stdin.end(JSON.stringify(wireRequest), 'utf8')
    })
  }

  private async withMutationLock<T>(targetKey: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.mutationLocks.get(targetKey) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.mutationLocks.set(targetKey, tail)
    try {
      return await run
    }
    finally {
      if (this.mutationLocks.get(targetKey) === tail) this.mutationLocks.delete(targetKey)
    }
  }

  private throwIfAborted(signal: AbortSignal | undefined, operation: string): void {
    if (signal?.aborted) throw new FsError(`${operation} aborted`, 'FS_ABORTED')
  }
}

export default EsafenetFileSystem
