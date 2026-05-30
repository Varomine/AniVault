import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Play, Bookmark, ExternalLink, Star, Tv, Clock, Calendar, AlertCircle, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { searchAnikage, getAnikageEpisodes, getAnikageStreams, getBestSource } from '../../services/animepaheApi';
import { getAnimeById, getAnimeRecommendations, getStatusText, getStatusClass } from '../../services/jikanApi';
import { useAuth } from '../../contexts/AuthContext';
import { addBookmark, removeBookmark, isBookmarked } from '../../services/bookmarkService';
import { updateWatchHistory, saveEpisodeProgress, getEpisodeProgress } from '../../services/watchHistoryService';
import HlsPlayer from '../../components/HlsPlayer/HlsPlayer';
import './Streaming.css';

// Cache slugs to avoid re-searching
const slugCache = new Map();

function Streaming({ onShowAuth }) {
  const { id, episode: episodeParam } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const [anime, setAnime] = useState(null);
  const [animeLoading, setAnimeLoading] = useState(true);

  const [anikageSlug, setAnikageSlug] = useState(null);
  const [anikageEpisodes, setAnikageEpisodes] = useState([]);
  const [totalEpisodeCount, setTotalEpisodeCount] = useState(0);

  const [currentEpisode, setCurrentEpisode] = useState(parseInt(episodeParam) || 1);
  const [streamSources, setStreamSources] = useState([]);
  const [introTimestamp, setIntroTimestamp] = useState(null);
  const [outroTimestamp, setOutroTimestamp] = useState(null);

  const [activeServer, setActiveServer] = useState('pahe');
  const [showServerModal, setShowServerModal] = useState(false);

  const [searchLoading, setSearchLoading] = useState(false);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [sourceError, setSourceError] = useState(null);

  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [relatedAnime, setRelatedAnime] = useState([]);

  // Episode pagination state
  const [episodesPage, setEpisodesPage] = useState(0);

  // Player Refresh and Related load more states
  const [playerResetKey, setPlayerResetKey] = useState(0);
  const [showAllRelated, setShowAllRelated] = useState(false);

  // Track if slug has been resolved for this anime ID
  const resolvedForId = useRef(null);

  const rangesScrollRef = useRef(null);
  const scrollRanges = useCallback((direction) => {
    if (rangesScrollRef.current) {
      const scrollAmount = direction === 'left' ? -120 : 120;
      rangesScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  }, []);

  // iOS check
  const IS_IOS = useMemo(() => {
    return typeof navigator !== 'undefined' && (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }, []);

  // Get best source from streamSources for iOS fallback
  const bestSource = useMemo(() => {
    return getBestSource(streamSources);
  }, [streamSources]);

  // Search Anikage for matching anime
  async function searchAnikageForAnime(animeData, malId, cancelled) {
    setSearchLoading(true);
    setSearchError(null);

    const titles = [...new Set([
      animeData.title,
      animeData.title_english,
      animeData.title_japanese,
    ].filter(Boolean))];

    for (const title of titles) {
      if (cancelled) return;
      try {
        const results = await searchAnikage(title);
        if (cancelled || results.length === 0) continue;

        // Better matching: prefer matching title AND episode count
        let match = results[0];
        const jikanEps = animeData.episodes || 0;

        // Try exact title match first
        const exactMatch = results.find(r => {
          const rTitle = (r.title?.english || r.title?.romaji || '').toLowerCase();
          return rTitle === title.toLowerCase();
        });
        if (exactMatch) match = exactMatch;

        // If multiple results, prefer one with matching episode count for TV series
        if (jikanEps > 0 && results.length > 1) {
          const epMatch = results.find(r => {
            const rEps = r.totalEpisodes || r.currentEpisode || 0;
            return Math.abs(rEps - jikanEps) <= 2;
          });
          if (epMatch) match = epMatch;
        }

        // Cache it
        slugCache.set(malId, { slug: match.slug, totalEpisodes: match.totalEpisodes || match.currentEpisode || 0 });
        setAnikageSlug(match.slug);
        setTotalEpisodeCount(match.totalEpisodes || match.currentEpisode || 0);
        resolvedForId.current = malId;
        setSearchLoading(false);
        return;
      } catch (err) { console.error(`Search failed for "${title}":`, err); }
    }

    if (!cancelled) {
      setSearchError('Anime not found on streaming server.');
      setSearchLoading(false);
    }
  }

  // ---- Step 1+2: Fetch Jikan + search Anikage IN PARALLEL ----
  useEffect(() => {
    let cancelled = false;
    const malId = parseInt(id);

    // Reset state for new anime
    Promise.resolve().then(() => {
      if (cancelled) return;
      setAnime(null);
      setAnimeLoading(true);
      setAnikageSlug(null);
      setAnikageEpisodes([]);
      setSearchError(null);
      setStreamSources([]);
    });
    resolvedForId.current = null;

    // Check slug cache
    if (slugCache.has(malId)) {
      const cached = slugCache.get(malId);
      Promise.resolve().then(() => {
        if (cancelled) return;
        setAnikageSlug(cached.slug);
        setTotalEpisodeCount(cached.totalEpisodes || 0);
      });
    }

    // Fetch Jikan anime data
    const fetchAnime = async () => {
      try {
        const data = await getAnimeById(malId);
        if (cancelled) return;
        setAnime(data.data);
        setAnimeLoading(false);

        // Only search Anikage if not cached
        if (!slugCache.has(malId)) {
          searchAnikageForAnime(data.data, malId, cancelled);
        }
      } catch (err) {
        if (!cancelled) { console.error('Jikan error:', err); setAnimeLoading(false); }
      }
    };

    fetchAnime();
    window.scrollTo(0, 0);

    return () => { cancelled = true; };
  }, [id]);

  // ---- Step 3: Fetch episodes from Anikage (runs when slug resolved) ----
  useEffect(() => {
    if (!anikageSlug) return;
    let cancelled = false;

    const fetchEpisodes = async () => {
      setEpisodesLoading(true);
      try {
        const { total, episodes } = await getAnikageEpisodes(anikageSlug);
        if (cancelled) return;
        setAnikageEpisodes(episodes);
        if (total > 0) setTotalEpisodeCount(total);
      } catch (err) { console.error('Episodes error:', err); }
      finally { if (!cancelled) setEpisodesLoading(false); }
    };

    fetchEpisodes();
    return () => { cancelled = true; };
  }, [anikageSlug]);

  // ---- Step 4: Get stream when episode changes ----
  useEffect(() => {
    if (!anikageSlug) return;
    let cancelled = false;

    const fetchStream = async () => {
      setSourceLoading(true);
      setSourceError(null);
      setStreamSources([]);
      setIntroTimestamp(null);
      setOutroTimestamp(null);

      try {
        const data = await getAnikageStreams(anikageSlug, currentEpisode);
        if (cancelled) return;
        if (!data?.sources?.length) {
          setSourceError('No streaming source for this episode.');
          return;
        }
        setStreamSources(data.sources);
        setIntroTimestamp(data.intro);
        setOutroTimestamp(data.outro);
      } catch (err) {
        if (!cancelled) { console.error('Stream error:', err); setSourceError('Failed to load stream.'); }
      } finally {
        if (!cancelled) setSourceLoading(false);
      }
    };

    fetchStream();
    return () => { cancelled = true; };
  }, [anikageSlug, currentEpisode]);

  // ---- Related anime (delayed to not block) ----
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(async () => {
      try {
        const data = await getAnimeRecommendations(id);
        setRelatedAnime((data.data || []).slice(0, 8).map(rec => rec.entry));
      } catch { /* ignore */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [id]);

  // ---- Update URL on ep change ----
  useEffect(() => {
    const p = parseInt(episodeParam) || 1;
    if (currentEpisode !== p) navigate(`/watch/${id}/${currentEpisode}`, { replace: true });
  }, [currentEpisode, id, navigate, episodeParam]);

  // ---- Listen to message from iframe player for watch progress ----
  useEffect(() => {
    const handleMessage = (e) => {
      if (e.data && e.data.type === 'PLAYER_TIMEUPDATE') {
        const { currentTime, duration } = e.data;
        if (currentTime && duration) {
          saveEpisodeProgress(parseInt(id), currentEpisode, currentTime, duration);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [id, currentEpisode]);

    // empty hook slot

  // ---- Bookmark ----
  useEffect(() => {
    if (!anime || !isAuthenticated || !user) return;
    isBookmarked(user.uid, anime.mal_id).then(setBookmarked);
  }, [anime, isAuthenticated, user]);

  const handleBookmark = useCallback(async () => {
    if (!isAuthenticated) {
      if (onShowAuth) onShowAuth();
      return;
    }
    if (!anime || bookmarkLoading) return;
    setBookmarkLoading(true);
    try {
      if (bookmarked) {
        await removeBookmark(user.uid, anime.mal_id);
        setBookmarked(false);
      } else {
        await addBookmark(user.uid, anime);
        setBookmarked(true);
      }
    } catch (err) { console.error(err); }
    finally { setBookmarkLoading(false); }
  }, [anime, bookmarked, bookmarkLoading, isAuthenticated, user, onShowAuth]);

  // ---- Refresh Video ----
  const handleRefreshVideo = useCallback(() => {
    setPlayerResetKey(prev => prev + 1);
  }, []);

  // ---- Episode list (from Anikage or generated) ----
  const episodeList = useMemo(() => {
    if (anikageEpisodes.length > 0) {
      return anikageEpisodes.filter(ep => ep.number > 0).sort((a, b) => a.number - b.number);
    }
    const count = totalEpisodeCount || anime?.episodes || 0;
    if (count > 0) {
      // Allow up to 1500 episodes for long running anime
      return Array.from({ length: Math.min(count, 1500) }, (_, i) => ({ number: i + 1, title: `Episode ${i + 1}` }));
    }
    return [];
  }, [anikageEpisodes, totalEpisodeCount, anime?.episodes]);

  const maxEpisode = episodeList.length > 0 ? Math.max(...episodeList.map(ep => ep.number)) : 0;
  const currentEpInfo = anikageEpisodes.find(ep => ep.number === currentEpisode);

  // ---- Episode Pagination calculations ----
  const PAGE_SIZE = 100;
  const totalPages = Math.ceil(episodeList.length / PAGE_SIZE);

  // Sync active page tab to show current episode
  const [prevEpisode, setPrevEpisode] = useState(currentEpisode);
  if (currentEpisode !== prevEpisode) {
    setPrevEpisode(currentEpisode);
    setEpisodesPage(Math.floor((currentEpisode - 1) / PAGE_SIZE));
  }

  const paginatedEpisodes = useMemo(() => {
    const start = episodesPage * PAGE_SIZE;
    return episodeList.slice(start, start + PAGE_SIZE);
  }, [episodeList, episodesPage]);

  // ---- Update watch history when anime and episode are playing ----
  useEffect(() => {
    if (anime && (streamSources.length > 0 || activeServer === 'koto')) {
      updateWatchHistory(anime, currentEpisode, currentEpInfo?.img);
    }
  }, [anime, currentEpisode, streamSources, currentEpInfo, activeServer]);

  // ---- Episode nav handlers ----
  const handleEpisodeSelect = useCallback((n) => { if (n !== currentEpisode) setCurrentEpisode(n); }, [currentEpisode]);
  const handlePrev = useCallback(() => { if (currentEpisode > 1) setCurrentEpisode(p => p - 1); }, [currentEpisode]);
  const handleNext = useCallback(() => { if (currentEpisode < maxEpisode) setCurrentEpisode(p => p + 1); }, [currentEpisode, maxEpisode]);

  // ---- Derived display values ----
  const titleDisplay = anime?.title_english || anime?.title || '';
  const score = anime?.score || 'N/A';
  const type = anime?.type || '';
  const season = anime?.season ? anime.season.charAt(0).toUpperCase() + anime.season.slice(1) : '';
  const year = anime?.year || anime?.aired?.prop?.from?.year || '';
  const seasonYear = [season, year].filter(Boolean).join(' ');
  const duration = anime?.duration || '';
  const status = anime?.status || '';
  const synopsis = anime?.synopsis || '';
  const genres = anime?.genres || [];
  const totalEps = totalEpisodeCount || anime?.episodes || '?';

  // Loading state — only show loader if we don't have slug yet
  if (animeLoading && !anikageSlug) {
    return (
      <div className="streaming-page page-content">
        <div className="page-loader"><div className="spinner" /><span className="page-loader-text">Loading...</span></div>
      </div>
    );
  }

  return (
    <div className="streaming-page page-content">
      <div className="streaming-layout container">
        {/* Main Player Area */}
        <div className="streaming-main">
          <div className="streaming-player">
            {activeServer === 'koto' ? (
              <iframe
                src={`https://megaplay.buzz/stream/mal/${id}/${currentEpisode}/sub`}
                className="streaming-iframe"
                allowFullScreen
                scrolling="no"
                sandbox="allow-scripts allow-same-origin"
                title={`${titleDisplay} - Episode ${currentEpisode} (Koto)`}
              />
            ) : sourceLoading || searchLoading ? (
              <div className="streaming-player-loading">
                <div className="spinner" />
                <span>{searchLoading ? 'Finding anime...' : `Loading ep ${currentEpisode}...`}</span>
              </div>
            ) : sourceError ? (
              <div className="streaming-player-error">
                <AlertCircle size={40} />
                <span>{sourceError}</span>
              </div>
            ) : streamSources.length > 0 ? (
              IS_IOS && bestSource ? (
                <iframe
                  src={`/embed.html?url=${encodeURIComponent(bestSource.streamUrl)}&poster=${encodeURIComponent(anime?.images?.jpg?.large_image_url || '')}&t=${getEpisodeProgress(parseInt(id), currentEpisode)}`}
                  className="streaming-iframe"
                  allowFullScreen
                  scrolling="no"
                  title={`${titleDisplay} - Episode ${currentEpisode}`}
                />
              ) : (
                <HlsPlayer
                  key={`${anikageSlug}-${currentEpisode}-${playerResetKey}`}
                  sources={streamSources}
                  title={`${titleDisplay} - Episode ${currentEpisode}`}
                  intro={introTimestamp}
                  outro={outroTimestamp}
                  initialTime={getEpisodeProgress(parseInt(id), currentEpisode)}
                  onProgress={(time, duration) => {
                    saveEpisodeProgress(parseInt(id), currentEpisode, time, duration);
                  }}
                />
              )
            ) : searchError ? (
              <div className="streaming-player-error"><AlertCircle size={40} /><span>{searchError}</span></div>
            ) : (
              <div className="streaming-player-loading"><Play size={48} /><span>Select an episode</span></div>
            )}
          </div>

          {/* Unified Episode Navigation & Server Control Row */}
          <div className="streaming-ep-controls-row">
            <div className="streaming-ep-nav">
              <button className="streaming-ep-nav-btn" onClick={handlePrev} disabled={currentEpisode <= 1} title={`Episode ${currentEpisode - 1}`}>
                <ChevronLeft size={16} />
              </button>
              <div className="streaming-ep-nav-current">
                <span className="streaming-ep-nav-number">Ep {currentEpisode}</span>
              </div>
              <button className="streaming-ep-nav-btn" onClick={handleNext} disabled={maxEpisode > 0 && currentEpisode >= maxEpisode} title={`Episode ${currentEpisode + 1}`}>
                <ChevronRight size={16} />
              </button>
            </div>

            <button className="streaming-server-modal-trigger" onClick={() => setShowServerModal(true)}>
              <Tv size={14} />
              <span>SERVER</span>
            </button>
          </div>

          {/* Episode Info */}
          {currentEpInfo && (
            <div className="streaming-ep-info">
              {currentEpInfo.img && <img src={currentEpInfo.img} alt={currentEpInfo.title} className="streaming-ep-thumb" loading="lazy" />}
              <div className="streaming-ep-details">
                <span className="streaming-ep-num">Episode {currentEpInfo.number}</span>
                <h3 className="streaming-ep-title">{currentEpInfo.title}</h3>
                {currentEpInfo.description && <p className="streaming-ep-desc">{currentEpInfo.description}</p>}
              </div>
            </div>
          )}

          {/* Anime Info */}
          <div className="streaming-info">
            <span className="streaming-now-playing">NOW PLAYING</span>
            <h1 className="streaming-title">{titleDisplay}</h1>
            <p className="streaming-episode-label">Episode {currentEpisode} of {totalEps}</p>
            <div className="streaming-meta">
              {score !== 'N/A' && <span className="streaming-meta-badge streaming-score"><Star size={13} />{score}</span>}
              {type && <span className="streaming-meta-badge"><Tv size={13} />{type}</span>}
              {seasonYear && <span className="streaming-meta-badge"><Calendar size={13} />{seasonYear}</span>}
              {duration && <span className="streaming-meta-badge"><Clock size={13} />{duration}</span>}
              {status && <span className={`status-badge ${getStatusClass(status)}`}>{getStatusText(status)}</span>}
            </div>
            {genres.length > 0 && <div className="streaming-genres">{genres.map(g => <span key={g.mal_id} className="genre-tag">{g.name}</span>)}</div>}
            {synopsis && <p className="streaming-synopsis">{synopsis}</p>}
            <div className="streaming-info-actions">
              <Link to={`/anime/${id}`} className="btn btn-secondary"><ExternalLink size={14} /> Full Details</Link>
              <button className={`btn ${bookmarked ? 'btn-bookmark-active' : 'btn-secondary'}`} onClick={handleBookmark} disabled={bookmarkLoading}>
                <Bookmark size={14} fill={bookmarked ? 'currentColor' : 'none'} />{bookmarked ? 'Bookmarked' : 'Bookmark'}
              </button>
              <button className="btn btn-secondary" onClick={handleRefreshVideo}>
                <RefreshCw size={14} /> Refresh Video
              </button>
            </div>
          </div>
        </div>

        {/* Episodes Panel */}
        <div className="streaming-episodes-panel">
          <div className="streaming-episodes-header">
            <h3>EPISODES</h3>
            <span className="streaming-episodes-count">
              {episodesLoading ? 'Loading...' : episodeList.length > 0 ? `${episodeList.length} available` : 'N/A'}
            </span>
          </div>

          {episodesLoading ? (
            <div className="streaming-episodes-loading"><div className="spinner" /><span>Loading...</span></div>
          ) : episodeList.length > 0 ? (
            <>
              {totalPages > 1 && (
                <div className="streaming-ep-ranges-container">
                  <button
                    className="streaming-range-scroll-btn left"
                    onClick={() => scrollRanges('left')}
                    aria-label="Scroll left"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <div className="streaming-ep-pagination" ref={rangesScrollRef}>
                    {Array.from({ length: totalPages }, (_, i) => {
                      const start = i * PAGE_SIZE + 1;
                      const end = Math.min((i + 1) * PAGE_SIZE, episodeList.length);
                      return (
                        <button
                          key={i}
                          className={`streaming-page-tab-btn ${episodesPage === i ? 'active' : ''}`}
                          onClick={() => setEpisodesPage(i)}
                        >
                          {start}-{end}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="streaming-range-scroll-btn right"
                    onClick={() => scrollRanges('right')}
                    aria-label="Scroll right"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
              <div className="streaming-episodes-grid">
                {paginatedEpisodes.map(ep => (
                  <button key={ep.number}
                    className={`streaming-episode-btn ${ep.number === currentEpisode ? 'active' : ''}`}
                    onClick={() => handleEpisodeSelect(ep.number)}
                    title={ep.title || `Episode ${ep.number}`}
                  >{ep.number}</button>
                ))}
              </div>
            </>
          ) : searchError ? (
            <div className="streaming-episodes-empty"><AlertCircle size={24} /><p>{searchError}</p></div>
          ) : (
            <div className="streaming-episodes-empty"><AlertCircle size={24} /><p>No episodes available.</p></div>
          )}

          {relatedAnime.length > 0 && (
            <div className="streaming-related">
              <h4 className="streaming-related-title">RELATED</h4>
              <div className="streaming-related-list">
                {(showAllRelated ? relatedAnime : relatedAnime.slice(0, 4)).map(r => (
                  <Link key={r.mal_id} to={`/anime/${r.mal_id}`} className="streaming-related-item">
                    <img src={r.images?.jpg?.small_image_url || r.images?.jpg?.image_url || ''} alt={r.title} loading="lazy" />
                    <span>{r.title}</span>
                  </Link>
                ))}
              </div>
              {relatedAnime.length > 4 && (
                <button
                  className="streaming-related-toggle-btn"
                  onClick={() => setShowAllRelated(!showAllRelated)}
                >
                  {showAllRelated ? 'Show Less' : `Show More (${relatedAnime.length - 4} more)`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Server Selection Modal */}
      {showServerModal && (
        <div className="modal-overlay" onClick={() => setShowServerModal(false)}>
          <div className="modal-content server-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="server-modal-header">
              <h2 className="server-modal-title">SERVER</h2>
              <button className="server-modal-close" onClick={() => setShowServerModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="server-modal-options">
              <button
                type="button"
                className={`server-modal-option ${activeServer === 'pahe' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('pahe');
                  setShowServerModal(false);
                }}
              >
                <span>pahe</span>
                <span className="server-status-dot" />
              </button>
              <button
                type="button"
                className={`server-modal-option ${activeServer === 'koto' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('koto');
                  setShowServerModal(false);
                }}
              >
                <span>Koto</span>
                <span className="server-status-dot" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Streaming;
