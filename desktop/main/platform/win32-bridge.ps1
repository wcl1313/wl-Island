# Islet — Windows system bridge.
#
# Runs as ONE long-lived powershell.exe and speaks JSON lines over stdin/stdout.
# Spawning a fresh PowerShell every poll would cost 250-400 ms + a process
# creation per tick; a resident bridge costs ~0 when idle.
#
#   in : {"id":1,"cmd":"media.status"}
#   out: {"id":1,"ok":true,"data":{...}}
#
# Commands: ping | media.* | bt.list | net.info | proc.top | mouse.left | act.mute
#           dev.usb | dev.com | fg.fullscreen | sys.storage | sys.cleanTemp | sys.hibernate

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

# Never wait forever. A player that answers `TryGetMediaPropertiesAsync` late (or
# not at all — some Chinese players do exactly this when a track changes) used to
# block the whole resident bridge, after which *every* command timed out and the
# island showed "nothing playing" until restart.
function Await($op, $type, $ms = 2500) {
  if ($null -eq $op) { return $null }
  $t = $script:asTask.MakeGenericMethod($type)
  $task = $t.Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw "winrt timeout (${ms}ms)" }
  return $task.Result
}

# --- type loads (lazy, wrapped: on Windows 10 N editions these can fail) ------
$script:smtcReady = $false
function Init-Smtc {
  if ($script:smtcReady) { return $true }
  try {
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $script:smtcReady = $true
  } catch {
    $script:smtcReady = $false
  }
  return $script:smtcReady
}

# The manager object stays valid across track changes and is refreshed by the OS,
# so cache it: RequestAsync costs 150–300 ms and we call it every poll.
$script:mgr = $null
$script:mgrAt = [DateTime]::MinValue
function Get-Manager {
  if (-not (Init-Smtc)) { return $null }
  if ($null -ne $script:mgr -and ([DateTime]::Now - $script:mgrAt).TotalSeconds -lt 180) {
    try { $null = $script:mgr.GetSessions(); return $script:mgr } catch { $script:mgr = $null }
  }
  try {
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $script:mgr = Await ($mgrType::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $script:mgrAt = [DateTime]::Now
    return $script:mgr
  } catch { $script:mgr = $null; return $null }
}

# $target pins one player. Without it we pick the session that is actually
# playing rather than trusting GetCurrentSession(): 网易云 keeps a paused session
# registered long after you switch to something else, and "current" follows the
# last window you touched, so the old code regularly showed the wrong track (or
# nothing at all) while music was clearly playing.
function Get-Session([string]$target) {
  $mgr = Get-Manager
  if ($null -eq $mgr) { return $null }
  $all = @()
  try { $all = @($mgr.GetSessions()) } catch { return $null }
  if ($all.Count -eq 0) { return $null }

  if ($target) {
    foreach ($s in $all) {
      $id = [string]$s.SourceAppUserModelId
      if ($id -eq $target -or $id -like "*$target*" -or $id -like "*$([IO.Path]::GetFileNameWithoutExtension($target))*") { return $s }
    }
  }

  foreach ($s in $all) {
    try {
      if ($s.GetPlaybackInfo().PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsPlaybackStatus]::Playing) { return $s }
    } catch {}
  }
  try {
    $cur = $mgr.GetCurrentSession()
    if ($null -ne $cur) { return $cur }
  } catch {}
  # Only paused sessions left: prefer one that still has a title.
  return $all[0]
}

function Cmd-MediaSessions {
  $mgr = Get-Manager
  $out = @()
  if ($null -eq $mgr) { return @() }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    foreach ($s in $mgr.GetSessions()) {
      $t = ''; $ar = ''; $playing = $false
      try {
        $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) 1500
        if ($null -ne $p) { $t = [string]$p.Title; $ar = [string]$p.Artist }
      } catch {}
      try { $playing = ($s.GetPlaybackInfo().PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsPlaybackStatus]::Playing) } catch {}
      $out += @{ id = $s.SourceAppUserModelId; app = (Friendly-App $s.SourceAppUserModelId); title = $t; artist = $ar; playing = $playing }
    }
  } catch {} finally { $ErrorActionPreference = $prev }
  return @($out)
}

# --- media keys (works for players that never publish SMTC, e.g. some
# --- Chinese players / browser players) --------------------------------------
$script:keysLoaded = $false
function Init-Keys {
  if ($script:keysLoaded) { return }
  Add-Type -Namespace IsletNative -Name Keys -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@
  $script:keysLoaded = $true
}
function Send-MediaKey([byte]$vk) {
  Init-Keys
  [IsletNative.Keys]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 24
  [IsletNative.Keys]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
}

$VK = @{ next = 0xB0; prev = 0xB1; stop = 0xB2; playpause = 0xB3 }

# --- mouse button state -----------------------------------------------------
# The island drag follows the cursor with a timer. A fast flick can push the
# pointer outside the (moving) window and the renderer's pointerup never
# arrives, so the drag also asks the OS whether the button is still down.
$script:mouseReady = $false
function Init-Mouse {
  if ($script:mouseReady) { return }
  Add-Type -Namespace WlNative -Name Mouse -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern short GetAsyncKeyState(int vKey);
'@
  $script:mouseReady = $true
}
function Cmd-MouseLeft {
  Init-Mouse
  return @{ down = [bool]([WlNative.Mouse]::GetAsyncKeyState(0x01) -band 0x8000) }
}
function Cmd-ActMute {
  Send-MediaKey 0xAD
  return @{ ok = $true }
}

function Friendly-App([string]$aumid) {
  if (-not $aumid) { return '播放器' }
  $map = @{
    'cloudmusic.exe'           = '网易云音乐'
    'QQMusic.exe'              = 'QQ 音乐'
    'QQMusic'                  = 'QQ 音乐'
    'Spotify.exe'              = 'Spotify'
    'SpotifyAB.SpotifyMusic'   = 'Spotify'
    'Bodian.exe'               = '波点音乐'
    'bodian'                   = '波点音乐'
    'Music.UI.exe'             = '媒体播放器'
    'Microsoft.ZuneMusic'      = '媒体播放器'
    'foobar2000.exe'           = 'foobar2000'
    'AIMP.exe'                 = 'AIMP'
    'KuGou.exe'                = '酷狗音乐'
    'KwMusic.exe'              = '酷我音乐'
    'chrome.exe'               = '浏览器'
    'msedge.exe'               = '浏览器'
    'firefox.exe'              = '浏览器'
  }
  foreach ($k in $map.Keys) {
    if ($aumid -like "*$k*") { return $map[$k] }
  }
  return ([System.IO.Path]::GetFileNameWithoutExtension($aumid))
}

# --- commands ---------------------------------------------------------------
function Cmd-MediaStatus($req) {
  # Every sub-call is isolated. 网易云 answers PlaybackInfo but throws on
  # TimelineProperties, QQ音乐 used to throw on both — one bad getter must not
  # turn the whole response into `ok:false`, which the UI renders as silence.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $s = Get-Session ([string]$req.target)
    if ($null -eq $s) {
      return @{ active = $false; app = $null; title = $null; artist = $null; album = $null;
                playing = $false; position = 0; duration = 0; canSeek = $false; canControl = $true;
                hasArt = $false; sessions = 0 }
    }

    $appId = ''
    try { $appId = [string]$s.SourceAppUserModelId } catch {}

    $title = ''; $artist = ''; $album = ''; $hasArt = $false
    try {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) 1800
      if ($null -ne $props) {
        $title = [string]$props.Title
        $artist = [string]$props.Artist
        $album = [string]$props.AlbumTitle
        try { $hasArt = ($null -ne $props.Thumbnail) } catch {}
      }
    } catch {}

    $playing = $false; $canSeek = $false
    try {
      $info = $s.GetPlaybackInfo()
      if ($null -ne $info) {
        try { $playing = ($info.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsPlaybackStatus]::Playing) } catch {}
        try { $canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled } catch {}
      }
    } catch {}

    $pos = 0; $dur = 0
    try {
      $tl = $s.GetTimelineProperties()
      if ($null -ne $tl) {
        try { $pos = [math]::Round($tl.Position.TotalSeconds, 1) } catch {}
        try { $dur = [math]::Round($tl.EndTime.TotalSeconds, 1) } catch {}
        if ($dur -le 0) { try { $dur = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 1) } catch {} }
      }
    } catch {}

    $count = 0
    try { $count = @((Get-Manager).GetSessions()).Count } catch {}

    return @{
      active   = ($title.Length -gt 0 -or $playing)
      app      = (Friendly-App $appId)
      appId    = $appId
      title    = $title
      artist   = $artist
      album    = $album
      playing  = $playing
      position = $pos
      duration = $dur
      canSeek  = $canSeek
      canControl = $true
      hasArt   = $hasArt
      sessions = $count
    }
  } catch {
    return @{ active = $false; app = $null; title = $null; artist = $null; album = $null;
              playing = $false; position = 0; duration = 0; canSeek = $false; canControl = $true;
              hasArt = $false; sessions = 0; error = $_.Exception.Message }
  } finally {
    $ErrorActionPreference = $prev
  }
}

# --- players that never publish an SMTC session -----------------------------
# 网易云音乐 3.x is Chromium and launches with
#   --disable-features=...,MediaSessionService,...
# so it registers *nothing* with GlobalSystemMediaTransportControls: on a
# machine where it is the only player, Get-Session() returns $null and the
# island showed "nothing playing" while music was clearly audible.
#
# Two OS signals survive that:
#   • the window title still carries "歌曲 - 歌手"
#   • Core Audio's endpoint peak meter tells us whether sound is actually
#     leaving the speakers
#
# Session *state* is NOT usable for playback here: Chromium keeps its audio
# stream Active for ever after a pause (measured: still Active 6 s later), so
# only the peak meter distinguishes playing from paused.
if (-not ('WlFb.Win' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

namespace WlFb {
  public class WinInfo { public long H; public uint Pid; public string Title; }

  public static class Win {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    public static List<WinInfo> All() {
      var list = new List<WinInfo>();
      EnumWindows((h, l) => {
        int len = GetWindowTextLength(h);
        if (len <= 0 || len > 400) return true;
        var sb = new StringBuilder(len + 2);
        if (GetWindowText(h, sb, sb.Capacity) <= 0) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        list.Add(new WinInfo { H = h.ToInt64(), Pid = pid, Title = sb.ToString() });
        return true;
      }, IntPtr.Zero);
      return list;
    }
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator { }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    int GetDevice(string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IntPtr props);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }
  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
    int GetMeteringChannelCount(out int count);
    int GetChannelsPeakValues(int count, [Out] float[] peaks);
    int QueryHardwareSupport(out int mask);
  }

  public static class Audio {
    static IAudioMeterInformation _meter;
    static long _at;
    static int _nulls;

    static IAudioMeterInformation Meter() {
      if (_meter != null && (DateTime.UtcNow.Ticks - _at) < TimeSpan.TicksPerSecond * 120) return _meter;
      try {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return null;
        var iid = typeof(IAudioMeterInformation).GUID;
        object obj;
        if (dev.Activate(ref iid, 23, IntPtr.Zero, out obj) != 0 || obj == null) return null;
        _meter = (IAudioMeterInformation)obj;
        _at = DateTime.UtcNow.Ticks;
        return _meter;
      } catch { return null; }
    }

    /// Some virtual/remote audio stacks have no endpoint meter at all. Report
    /// that separately: a missing meter must not be confused with "silence",
    /// otherwise the island would show a paused icon for music that is playing.
    public static bool MeterOk() { return Meter() != null; }

    /// Highest peak seen over `n` samples spaced `ms` apart. Music is not a
    /// square wave: a single instantaneous read regularly lands in a zero
    /// crossing or a gap between tracks, so sample a short window instead.
    public static float PeakMax(int n, int ms) {
      var m = Meter();
      if (m == null) { _nulls++; if (_nulls > 20) _meter = null; return 0f; }
      float best = 0f;
      for (int i = 0; i < n; i++) {
        float p;
        try { if (m.GetPeakValue(out p) == 0 && p > best) best = p; } catch { _meter = null; break; }
        if (i < n - 1) Thread.Sleep(ms);
      }
      return best;
    }
  }
}
'@
}

$script:playermap = @{
  'cloudmusic'    = '网易云音乐'
  'qqmusic'       = 'QQ 音乐'
  'kugou'         = '酷狗音乐'
  'kwmusic'       = '酷我音乐'
  'spotify'       = 'Spotify'
  'foobar2000'    = 'foobar2000'
  'aimp'          = 'AIMP'
  'musicbee'      = 'MusicBee'
  'applemusic'    = 'Apple Music'
  'bodian'        = '波点音乐'
}
$script:junkTitles = @(
  '网易云音乐', 'QQ音乐', 'QQ 音乐', '酷狗音乐', '酷我音乐', 'Spotify',
  'CloudMusic', '音乐', 'Media Player', '媒体播放器', '桌面歌词', '歌词'
)
# Players spawn helper windows (desktop lyrics, mini player) that also carry a
# title. "桌面歌词" must never win over the real player window, so every
# candidate is scored instead of taking the first hit.
$script:auxTitle = '歌词|Lyric|迷你|Mini|迷你播放器'

function Cmd-MediaFallback {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = @()
  $peak = 0.0
  $meter = $false
  try { $meter = [WlFb.Audio]::MeterOk() } catch {}
  try { $peak = [WlFb.Audio]::PeakMax(8, 22) } catch {}
  try {
    $procs = @{}
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
      $n = $p.ProcessName.ToLower()
      if ($script:playermap.ContainsKey($n)) { $procs[[string]$p.Id] = $n }
    }
    if ($procs.Count -gt 0) {
      $best = @{}
      foreach ($w in [WlFb.Win]::All()) {
        $k = [string]$w.Pid
        if (-not $procs.ContainsKey($k)) { continue }
        $pn = $procs[$k]
        $raw = ($w.Title -replace '\s+', ' ').Trim()
        if (-not $raw) { continue }
        # "song - artist - 网易云音乐" → drop the redundant app suffix.
        $raw = $raw -replace '\s*[-–—|]\s*(网易云音乐|QQ ?音乐|酷狗音乐|酷我音乐|Spotify|CloudMusic)\s*$', ''
        if ($raw.Length -gt 140) { $raw = $raw.Substring(0, 140) }
        $t = $raw
        $a = ''
        if ($raw -match '^(.{1,100}?)\s+[-–—|]\s+(.+)$') { $t = $Matches[1].Trim(); $a = $Matches[2].Trim() }
        if (-not $t) { continue }
        if ($script:junkTitles -contains $t) { continue }
        if ($t -eq $script:playermap[$pn]) { continue }
        $score = 10
        if ($raw -match '^(.{1,100}?)\s+[-–—|]\s+(.+)$') { $score += 10 }
        if ($t -match $script:auxTitle) { $score -= 25 }
        if (-not $best.ContainsKey($pn) -or $score -gt $best[$pn].score) {
          $best[$pn] = @{ score = $score; entry = @{
            app     = $script:playermap[$pn]
            process = $pn
            pid     = [int]$w.Pid
            title   = $t
            artist  = $a
          } }
        }
      }
      foreach ($pn in $best.Keys) {
        if ($best[$pn].score -gt 0) { $out += $best[$pn].entry }
      }
    }
  } catch {
  } finally {
    $ErrorActionPreference = $prev
  }
  return @{ players = @($out); peak = [math]::Round([double]$peak, 4); meter = [bool]$meter }
}

function Cmd-MediaArt($req) {
  $s = Get-Session ([string]$req.target)
  if ($null -eq $s) { return $null }
  try {
    $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $ref = $props.Thumbnail
    if ($null -eq $ref) { return $null }
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = [int]$stream.Size
    if ($size -le 0 -or $size -gt 8000000) { return $null }
    $reader = New-Object Windows.Storage.Streams.DataReader($stream)
    Await ($reader.LoadAsync([uint32]$size)) ([uint32]) | Out-Null
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    $reader.Dispose()
    $stream.Dispose()
    return @{ mime = 'image/png'; b64 = [Convert]::ToBase64String($bytes) }
  } catch { return $null }
}

function Cmd-MediaControl($req) {
  $action = [string]$req.action
  $s = Get-Session ([string]$req.target)
  $done = $false
  if ($null -ne $s) {
    try {
      switch ($action) {
        'toggle'   { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]); $done = $true }
        'play'     { $null = Await ($s.TryPlayAsync()) ([bool]); $done = $true }
        'pause'    { $null = Await ($s.TryPauseAsync()) ([bool]); $done = $true }
        'next'     { $null = Await ($s.TrySkipNextAsync()) ([bool]); $done = $true }
        'prev'     { $null = Await ($s.TrySkipPreviousAsync()) ([bool]); $done = $true }
        'seek'     {
          $ticks = [long]([double]$req.position * 10000000)
          $null = Await ($s.TryChangePlaybackPositionAsync($ticks)) ([bool]); $done = $true
        }
      }
    } catch { $done = $false }
  }
  if (-not $done) {
    switch ($action) {
      'toggle' { Send-MediaKey $VK.playpause; $done = $true }
      'play'   { Send-MediaKey $VK.playpause; $done = $true }
      'pause'  { Send-MediaKey $VK.playpause; $done = $true }
      'next'   { Send-MediaKey $VK.next; $done = $true }
      'prev'   { Send-MediaKey $VK.prev; $done = $true }
    }
  }
  return @{ handled = $done; via = $(if ($done) { 'smtc-or-media-key' } else { 'none' }) }
}

function Cmd-BtList {
  $out = @()
  $seen = @{}
  try {
    # Real peripherals enumerate as BTHENUM\Dev_<MAC> / BTHLE\Dev_<MAC>.
    # BTH\MS_* are Windows' own profile enumerators and must be hidden.
    $devs = Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
      $_.InstanceId -match '^BTH(ENUM|LE)\\Dev_' -and
      $_.FriendlyName -and
      $_.FriendlyName -notmatch '^(Microsoft|Bluetooth Device \()'
    }
    foreach ($d in $devs) {
      $mac = ''
      if ($d.InstanceId -match 'Dev_([0-9A-F]{12})') { $mac = $Matches[1] }
      $key = if ($mac) { $mac } else { $d.FriendlyName }
      if ($seen.ContainsKey($key)) {
        if ($d.Status -eq 'OK') { $seen[$key].connected = $true }
        continue
      }
      $entry = @{
        name      = $d.FriendlyName
        id        = $(if ($mac) { $mac } else { $d.InstanceId })
        status    = [string]$d.Status
        present   = $true
        connected = ($d.Status -eq 'OK')
      }
      $seen[$key] = $entry
      $out += $entry
    }
  } catch {}
  return @($out)
}

function Cmd-ProcTop {
  $out = @()
  try {
    $procs = Get-Process -ErrorAction Stop | Where-Object { $_.WorkingSet64 -gt 0 } |
      Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 5
    foreach ($p in $procs) {
      $out += @{ name = $p.ProcessName; mem = [int64]$p.WorkingSet64 }
    }
  } catch {}
  return @($out)
}

function Cmd-NetInfo {
  $b = $null
  try { $b = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1 } catch {}
  return @{ battery = $(if ($b) { [int]$b.EstimatedChargeRemaining } else { $null }) }
}

# --- devices ----------------------------------------------------------------
function Cmd-UsbList {
  $out = @()
  try {
    # `&MI_` entries are interface children of one physical device — the parent
    # entry already carries the friendly name, so children would double every
    # headset as three rows.
    # Real peripherals live in three places: the USB parent, USB storage, and
    # the HID child that carries the human name ("Logitech MX Master 3").
    # Generic hubs / composite parents / Windows' own profile enumerators are
    # noise and are filtered by name.
    $devs = Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
      $_.InstanceId -match '^(USB|USBSTOR|HID)\\' -and
      $_.FriendlyName -and
      $_.FriendlyName -notmatch 'Root Hub|根集线器|Generic USB Hub|通用 USB 集线器|Composite Device|复合设备|USB 输入设备|USB Input Device' -and
      $_.FriendlyName -notmatch '^符合 HID 标准的(用户控制|系统控制|供应商定义)|^HID-compliant (consumer|system|vendor)'
    }
    foreach ($d in $devs) {
      $out += @{
        name   = $d.FriendlyName
        cls    = [string]$d.Class
        status = [string]$d.Status
        id     = [string]$d.InstanceId
      }
    }
  } catch {}
  return @($out)
}

function Cmd-ComList {
  $out = @()
  try {
    $ports = Get-CimInstance Win32_SerialPort -ErrorAction Stop
    foreach ($p in $ports) {
      $dev = [string]$p.DeviceID
      $out += @{
        name   = [string]$p.Caption
        id     = $dev
        status = $(if ($p.Status) { [string]$p.Status } else { 'OK' })
      }
    }
  } catch {}
  if (@($out).Count -eq 0) {
    # Win32_SerialPort only lists *real* UARTs; USB-serial adapters (CH340,
    # CP210x, FTDI) show up in the SERIALCOMM map instead.
    try {
      $k = Get-ItemProperty 'HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM' -ErrorAction Stop
      foreach ($n in $k.PSObject.Properties) {
        if ($n.Name -like 'PSObject*' -or $n.Name -like 'PSPath*' -or $n.Name -like 'PSParent*') { continue }
        $friendly = ($n.Name -split '\\')[-1]
        $out += @{ name = $friendly; id = [string]$n.Value; status = 'OK' }
      }
    } catch {}
  }
  return @($out)
}

# --- foreground window (used for hide-on-fullscreen) ------------------------
if (-not ('WlFgWin' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WlFgWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
}

function Cmd-FgFullscreen {
  $res = @{ fullscreen = $false; cls = ''; pid = 0; title = '' }
  try {
    $h = [WlFgWin]::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero -or $h -eq [WlFgWin]::GetDesktopWindow() -or $h -eq [WlFgWin]::GetShellWindow()) {
      return $res
    }
    $sb = New-Object System.Text.StringBuilder 256
    [void][WlFgWin]::GetClassName($h, $sb, 256)
    $cls = $sb.ToString()
    $res.cls = $cls

    # Shell surfaces are never "an app going fullscreen".
    if ($cls -in @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow')) {
      return $res
    }

    $wpid = 0
    [void][WlFgWin]::GetWindowThreadProcessId($h, [ref]$wpid)
    $res.pid = [int]$wpid
    try {
      $p = Get-Process -Id $wpid -ErrorAction Stop
      if ($p.ProcessName -in @('wl-Island', 'electron', 'explorer')) { return $res }
    } catch {}

    $r = New-Object WlFgWin+RECT
    if (-not [WlFgWin]::GetWindowRect($h, [ref]$r)) { return $res }

    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    $wa = [System.Windows.Forms.Screen]::FromHandle($h).Bounds
    if (-not $wa) { return $res }

    $w = $r.Right - $r.Left
    $hh = $r.Bottom - $r.Top
    $covers = ($w -ge ($wa.Width - 2)) -and ($hh -ge ($wa.Height - 2))
    $atOrigin = ([Math]::Abs($r.Left - $wa.X) -le 2) -and ([Math]::Abs($r.Top - $wa.Y) -le 2)
    $res.fullscreen = ($covers -and $atOrigin)

    if ($res.fullscreen) {
      $tb = New-Object System.Text.StringBuilder 256
      [void][WlFgWin]::GetWindowText($h, $tb, 256)
      $res.title = $tb.ToString()
    }
  } catch {}
  return $res
}

# --- storage / cleanup ------------------------------------------------------
function Get-DirBytes([string]$path) {
  $sum = 0
  try {
    foreach ($f in (Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue)) {
      try {
        if ($f.PSIsContainer) {
          $inner = (Get-ChildItem -LiteralPath $f.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
                    Measure-Object -Property Length -Sum).Sum
          if ($inner) { $sum += [int64]$inner }
        } else {
          $sum += [int64]$f.Length
        }
      } catch {}
    }
  } catch {}
  return $sum
}

function Cmd-SysStorage {
  $res = @{ tempBytes = 0; tempCount = 0; tempPath = $env:TEMP; disk = $null; hiberfilBytes = 0; hibernateOn = $false }
  try {
    $items = @(Get-ChildItem -LiteralPath $env:TEMP -Force -ErrorAction SilentlyContinue)
    $res.tempCount = $items.Count
    $res.tempBytes = Get-DirBytes $env:TEMP
  } catch {}

  try {
    $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop
    if ($d) {
      $res.disk = @{
        total = [int64]$d.Size
        free  = [int64]$d.FreeSpace
        used  = [int64]($d.Size - $d.FreeSpace)
      }
    }
  } catch {}

  try {
    $hf = Get-Item -LiteralPath 'C:\hiberfil.sys' -Force -ErrorAction Stop
    $res.hiberfilBytes = [int64]$hf.Length
  } catch {}

  try {
    $p = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -ErrorAction Stop
    $res.hibernateOn = ([int]$p.HibernateEnabled -eq 1)
  } catch {}

  return $res
}

function Cmd-CleanTemp($req) {
  $days = 1
  try { if ($req.days) { $days = [double]$req.days } } catch {}
  $cutoff = (Get-Date).AddDays(-1 * $days)
  $removed = 0
  $freed = 0
  $targets = @(Get-ChildItem -LiteralPath $env:TEMP -Force -ErrorAction SilentlyContinue |
               Where-Object { $_.LastWriteTime -lt $cutoff })
  foreach ($f in $targets) {
    $size = 0
    try {
      if ($f.PSIsContainer) {
        $inner = (Get-ChildItem -LiteralPath $f.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
                  Measure-Object -Property Length -Sum).Sum
        if ($inner) { $size = [int64]$inner }
      } else {
        $size = [int64]$f.Length
      }
      Remove-Item -LiteralPath $f.FullName -Recurse -Force -ErrorAction Stop
      $removed += 1
      $freed += $size
    } catch {}
  }
  return @{ removed = $removed; freed = $freed; days = $days }
}

function Cmd-SetHibernate($req) {
  $on = $false
  try { $on = [bool]$req.on } catch {}
  $arg = if ($on) { 'on' } else { 'off' }
  $p = Start-Process -FilePath 'powercfg.exe' -ArgumentList @('/hibernate', $arg) -NoNewWindow -Wait -PassThru
  return @{ ok = ($p.ExitCode -eq 0); code = [int]$p.ExitCode; enabled = $on }
}

# --- REPL -------------------------------------------------------------------
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $data = $null
    switch ([string]$req.cmd) {
      'ping'           { $data = @{ pong = $true; pid = $PID } }
      'media.status'   { $data = Cmd-MediaStatus $req }
      'media.art'      { $data = Cmd-MediaArt $req }
      'media.sessions' { $data = @(Cmd-MediaSessions) }
      'media.control'  { $data = Cmd-MediaControl $req }
      'media.fallback' { $data = Cmd-MediaFallback }
      'bt.list'        { $data = Cmd-BtList }
      'net.info'       { $data = Cmd-NetInfo }
      'proc.top'       { $data = @(Cmd-ProcTop) }
      'mouse.left'     { $data = Cmd-MouseLeft }
      'act.mute'       { $data = Cmd-ActMute }
      'dev.usb'        { $data = @(Cmd-UsbList) }
      'dev.com'        { $data = @(Cmd-ComList) }
      'fg.fullscreen'  { $data = Cmd-FgFullscreen }
      'sys.storage'    { $data = Cmd-SysStorage }
      'sys.cleanTemp'  { $data = Cmd-CleanTemp $req }
      'sys.hibernate'  { $data = Cmd-SetHibernate $req }
      default         { throw "unknown cmd: $($req.cmd)" }
    }
    $resp = @{ id = $req.id; ok = $true; data = $data }
  } catch {
    $resp = @{ id = $(if ($req) { $req.id } else { 0 }); ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $resp -Compress -Depth 6))
  [Console]::Out.Flush()
}
