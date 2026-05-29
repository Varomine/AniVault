import { useEffect, useRef, useState, useCallback } from 'react';
import './HlsPlayer.css';

/**
 * Premium HLS Video Player
 * - Beautiful custom controls with gold accent theme
 * - Built-in quality selector (Auto + all available qualities)
 * - iOS fullscreen support (webkit + standard)
 * - Skip intro/outro buttons
 * - Auto-hide controls
 * - Keyboard shortcuts
 */
export default function HlsPlayer({ sources, initialQuality, poster, title, intro, outro, onError }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const controlsTimerRef = useRef(null);
  const progressRef = useRef(null);

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentQuality, setCurrentQuality] = useState(initialQuality || 'auto');
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const [showSkipOutro, setShowSkipOutro] = useState(false);

  // Build sources map: { quality: streamUrl }
  const qualityOptions = sources && sources.length > 0
    ? ['auto', ...sources.map(s => s.quality)]
    : ['auto'];

  const getStreamUrl = useCallback((quality) => {
    if (!sources || sources.length === 0) return null;
    if (quality === 'auto') {
      // Auto = best quality
      const priority = ['1080p', '720p', '480p', '360p'];
      for (const q of priority) {
        const s = sources.find(src => src.quality === q);
        if (s) return s.streamUrl;
      }
      return sources[0]?.streamUrl;
    }
    const match = sources.find(s => s.quality === quality);
    return match?.streamUrl || null;
  }, [sources]);

  // ---- Destroy HLS ----
  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // ---- Load hls.js from CDN ----
  const loadHlsScript = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (window.Hls) { resolve(window.Hls); return; }
      let script = document.querySelector('script[data-hls-js]');
      if (script) {
        if (window.Hls) { resolve(window.Hls); return; }
        const onLoad = () => { resolve(window.Hls); };
        script.addEventListener('load', onLoad, { once: true });
        script.addEventListener('error', () => reject(new Error('hls.js failed')), { once: true });
        return;
      }
      script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js';
      script.setAttribute('data-hls-js', 'true');
      script.onload = () => resolve(window.Hls);
      script.onerror = () => reject(new Error('Failed to load hls.js'));
      document.head.appendChild(script);
    });
  }, []);

  // ---- Initialize HLS when sources or quality changes ----
  useEffect(() => {
    const streamUrl = getStreamUrl(currentQuality);
    if (!streamUrl) { setLoading(false); return; }

    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);

    // Save current time for quality switch
    const savedTime = video.currentTime || 0;
    const wasPlaying = !video.paused;

    video.pause();

    // Native HLS (Safari/iOS)
    const canPlayNatively = video.canPlayType('application/vnd.apple.mpegurl') ||
                            video.canPlayType('application/x-mpegURL');

    if (canPlayNatively) {
      destroyHls();
      video.src = streamUrl;
      const onLoaded = () => {
        setLoading(false);
        if (savedTime > 1) video.currentTime = savedTime;
        if (wasPlaying || savedTime < 1) video.play().catch(() => {});
      };
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', () => {
        setError('Playback failed.');
        setLoading(false);
      }, { once: true });
      return () => destroyHls();
    }

    // hls.js for Chrome/Firefox/Edge
    let cancelled = false;
    loadHlsScript().then((Hls) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setError('Your browser does not support HLS video.');
        setLoading(false);
        return;
      }

      destroyHls();

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1,
        capLevelToPlayerSize: true,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        backBufferLength: 90,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 5,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        setLoading(false);
        if (savedTime > 1) video.currentTime = savedTime;
        if (wasPlaying || savedTime < 1) video.play().catch(() => {});
      });

      let recoverAttempts = 0;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled) return;
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            recoverAttempts++;
            if (recoverAttempts <= 3) hls.recoverMediaError();
            else { hls.detachMedia(); hls.attachMedia(video); hls.loadSource(streamUrl); recoverAttempts = 0; }
          } else {
            setError('Playback failed. Try refreshing.');
            setLoading(false);
          }
        }
      });

      // Stall recovery
      let stallTimer = null;
      const handleWaiting = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          if (video.paused || !hls) return;
          const t = video.currentTime;
          hls.recoverMediaError();
          setTimeout(() => { if (Math.abs(video.currentTime - t) < 0.5) video.currentTime = t + 0.5; }, 1000);
        }, 8000);
      };
      const handlePlaying = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
      video.addEventListener('waiting', handleWaiting);
      video.addEventListener('playing', handlePlaying);
    }).catch((err) => {
      if (cancelled) return;
      setError('Failed to load player.');
      setLoading(false);
    });

    return () => { cancelled = true; destroyHls(); };
  }, [currentQuality, sources, getStreamUrl, destroyHls, loadHlsScript]);

  // ---- Video event listeners ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      // Buffered
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
      // Skip intro/outro
      const t = video.currentTime;
      setShowSkipIntro(intro && t >= intro.start && t < intro.end);
      setShowSkipOutro(outro && t >= outro.start && t < outro.end);
    };
    const onDurationChange = () => setDuration(video.duration || 0);
    const onVolumeChange = () => { setVolume(video.volume); setMuted(video.muted); };
    const onEnded = () => setPlaying(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ended', onEnded);
    };
  }, [intro, outro]);

  // ---- Auto-hide controls ----
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3500);
  }, [playing]);

  useEffect(() => {
    if (!playing) { setShowControls(true); return; }
    resetControlsTimer();
    return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
  }, [playing, resetControlsTimer]);

  // ---- Fullscreen ----
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;

    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else {
      // Try container fullscreen first (shows custom controls)
      if (container.requestFullscreen) container.requestFullscreen();
      else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
      // iOS Safari: use video element's native fullscreen
      else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // ---- Player actions ----
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seek = useCallback((e) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
  }, [duration]);

  const handleVolumeChange = useCallback((e) => {
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    v.muted = val === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const skipIntro = useCallback(() => {
    if (videoRef.current && intro) { videoRef.current.currentTime = intro.end; setShowSkipIntro(false); }
  }, [intro]);

  const skipOutro = useCallback(() => {
    if (videoRef.current && outro) { videoRef.current.currentTime = outro.end; setShowSkipOutro(false); }
  }, [outro]);

  const switchQuality = useCallback((q) => {
    setCurrentQuality(q);
    setShowQualityMenu(false);
  }, []);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKey = (e) => {
      // Only if player is focused or in fullscreen
      if (!containerRef.current?.contains(document.activeElement) && !isFullscreen) return;
      const v = videoRef.current;
      if (!v) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          v.currentTime = Math.min(duration, v.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          v.volume = Math.min(1, v.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          v.volume = Math.max(0, v.volume - 0.1);
          break;
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [togglePlay, toggleFullscreen, toggleMute, duration, isFullscreen]);

  // ---- Cleanup ----
  useEffect(() => () => destroyHls(), [destroyHls]);

  // ---- Helpers ----
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const hasSources = sources && sources.length > 0;

  if (!hasSources) {
    return (
      <div className="vp-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="vp-placeholder-icon">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>No video source available</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`vp ${isFullscreen ? 'vp--fullscreen' : ''} ${showControls ? 'vp--show-controls' : ''}`}
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
      onClick={(e) => {
        // Close quality menu on outside click
        if (showQualityMenu && !e.target.closest('.vp-quality')) setShowQualityMenu(false);
      }}
      tabIndex={0}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="vp-video"
        playsInline
        webkit-playsinline=""
        poster={poster}
        title={title}
        preload="auto"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {/* Loading Overlay */}
      {loading && (
        <div className="vp-overlay vp-loading">
          <div className="vp-spinner" />
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="vp-overlay vp-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="36" height="36">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Big Play Button (when paused & controls visible) */}
      {!playing && !loading && !error && showControls && (
        <button className="vp-big-play" onClick={togglePlay} aria-label="Play">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        </button>
      )}

      {/* Skip Intro */}
      {showSkipIntro && (
        <button className="vp-skip-btn" onClick={skipIntro}>Skip Intro →</button>
      )}

      {/* Skip Outro */}
      {showSkipOutro && (
        <button className="vp-skip-btn vp-skip-outro" onClick={skipOutro}>Skip Outro →</button>
      )}

      {/* Bottom Gradient */}
      <div className={`vp-gradient ${showControls ? 'visible' : ''}`} />

      {/* Controls */}
      <div className={`vp-controls ${showControls ? 'visible' : ''}`}>
        {/* Progress Bar */}
        <div className="vp-progress-wrapper" ref={progressRef} onClick={seek}>
          <div className="vp-progress-bar">
            <div className="vp-progress-buffered" style={{ width: `${bufferedPct}%` }} />
            <div className="vp-progress-played" style={{ width: `${progressPct}%` }}>
              <div className="vp-progress-thumb" />
            </div>
          </div>
        </div>

        {/* Controls Row */}
        <div className="vp-controls-row">
          {/* Left Controls */}
          <div className="vp-controls-left">
            {/* Play/Pause */}
            <button className="vp-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              )}
            </button>

            {/* Volume */}
            <div className="vp-volume">
              <button className="vp-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />{volume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
                  </svg>
                )}
              </button>
              <input
                type="range"
                className="vp-volume-slider"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
              />
            </div>

            {/* Time */}
            <span className="vp-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>

          {/* Right Controls */}
          <div className="vp-controls-right">
            {/* Quality Selector */}
            <div className="vp-quality">
              <button className="vp-btn vp-quality-btn" onClick={() => setShowQualityMenu(!showQualityMenu)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span className="vp-quality-label">{currentQuality === 'auto' ? 'Auto' : currentQuality}</span>
              </button>

              {showQualityMenu && (
                <div className="vp-quality-menu">
                  {qualityOptions.map(q => (
                    <button
                      key={q}
                      className={`vp-quality-option ${currentQuality === q ? 'active' : ''}`}
                      onClick={() => switchQuality(q)}
                    >
                      {q === 'auto' ? 'Auto' : q}
                      {currentQuality === q && <span className="vp-quality-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen */}
            <button className="vp-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}