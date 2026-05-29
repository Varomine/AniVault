import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Play, SkipBack, SkipForward, RefreshCw, Bookmark, ExternalLink, Star, Tv, Clock, Calendar, AlertCircle } from 'lucide-react';
import { searchAnikage, getAnikageEpisodes, getAnikageStreams, getBestSource } from '../../services/animepaheApi';
import { getAnimeById, getAnimeRecommendations, getStatusText, getStatusClass } from '../../services/jikanApi';
import { useAuth } from '../../contexts/AuthContext';
import { addBookmark, removeBookmark, isBookmarked } from '../../services/bookmarkService';
import HlsPlayer from '../../components/HlsPlayer/HlsPlayer';
import './Streaming.css';

function Streaming() {
  const { id, episode: episodeParam } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  // Jikan data
  const [anime, setAnime] = useState(null);
  const [animeLoading, setAnimeLoading] = useState(true);

  // Anikage data
  const [anikageSlug, setAnikageSlug] = useState(null);
  const [anikageEpisodes, setAnikageEpisodes] = useState([]);
  const [totalEpisodeCount, setTotalEpisodeCount] = useState(0);

  // Stream state
  const [currentEpisode, setCurrentEpisode] = useState(parseInt(episodeParam) || 1);
  const [streamSources, setStreamSources] = useState([]);
  const [introTimestamp, setIntroTimestamp] = useState(null);
  const [outroTimestamp, setOutroTimestamp] = useState(null);

  // Loading & error
  const [searchLoading, setSearchLoading] = useState(false);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [sourceError, setSourceError] = useState(null);

  // Bookmark
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);

  // Related anime
  const [relatedAnime, setRelatedAnime] = useState([]);

  // ---- Step 1: Fetch anime info ----
  useEffect(() => {
    async function fetchAnime() {
      setAnimeLoading(true);
      try {
        const data = await getAnimeById(id);
        setAnime(data.data);
      } catch (err) {
        console.error('Failed to fetch anime:', err);
      } finally {
        setAnimeLoading(false);
      }
    }
    fetchAnime();
    window.scrollTo(0, 0);
  }, [id]);

  // ---- Step 2: Search Anikage ----
  useEffect(() => {
    if (!anime) return;
    async function searchForAnime() {
      setSearchLoading(true);
      setSearchError(null);
      const titles = [...new Set([anime.title, anime.title_english, anime.title_japanese].filter(Boolean))];
      for (const title of titles) {
        try {
          const results = await searchAnikage(title);
          if (results.length > 0) {
            const match = results.find(r => {
              const rTitle = (r.title?.english || r.title?.romaji || '').toLowerCase();
              const s = title.toLowerCase();
              return rTitle === s || rTitle.includes(s) || s.includes(rTitle);
            }) || results[0];
            setAnikageSlug(match.slug);
            setTotalEpisodeCount(match.totalEpisodes || match.currentEpisode || 0);
            setSearchLoading(false);
            return;
          }
        } catch (err) { console.error(`Search failed for "${title}":`, err); }
      }
      setSearchError('This anime was not found on the streaming server.');
      setSearchLoading(false);
    }
    searchForAnime();
  }, [anime]);

  // ---- Step 3: Fetch episodes ----
  useEffect(() => {
    if (!anikageSlug) return;
    async function fetchEpisodes() {
      setEpisodesLoading(true);
      try {
        const { total, episodes } = await getAnikageEpisodes(anikageSlug);
        setAnikageEpisodes(episodes);
        if (total > 0) setTotalEpisodeCount(total);
      } catch (err) { console.error('Failed to fetch episodes:', err); }
      finally { setEpisodesLoading(false); }
    }
    fetchEpisodes();
  }, [anikageSlug]);

  // ---- Step 4: Get stream sources ----
  useEffect(() => {
    if (!anikageSlug) return;
    async function fetchStream() {
      setSourceLoading(true);
      setSourceError(null);
      setStreamSources([]);
      setIntroTimestamp(null);
      setOutroTimestamp(null);
      try {
        const data = await getAnikageStreams(anikageSlug, currentEpisode);
        if (!data || !data.sources || data.sources.length === 0) {
          setSourceError('No streaming source available for this episode.');
          return;
        }
        setStreamSources(data.sources);
        setIntroTimestamp(data.intro);
        setOutroTimestamp(data.outro);
      } catch (err) {
        console.error('Stream error:', err);
        setSourceError('Failed to load streaming source.');
      } finally {
        setSourceLoading(false);
      }
    }
    fetchStream();
  }, [anikageSlug, currentEpisode]);

  // ---- Related anime ----
  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(async () => {
      try {
        const data = await getAnimeRecommendations(id);
        setRelatedAnime((data.data || []).slice(0, 8).map(rec => rec.entry));
      } catch (err) { console.error('Failed to fetch related:', err); }
    }, 1200);
    return () => clearTimeout(timer);
  }, [id]);

  // ---- Update URL on episode change ----
  useEffect(() => {
    const paramEp = parseInt(episodeParam) || 1;
    if (currentEpisode !== paramEp) {
      navigate(`/watch/${id}/${currentEpisode}`, { replace: true });
    }
  }, [currentEpisode, id, navigate, episodeParam]);

  // ---- Bookmark ----
  useEffect(() => {
    async function check() {
      if (!anime || !isAuthenticated || !user) return;
      setBookmarked(await isBookmarked(user.uid, anime.mal_id));
    }
    check();
  }, [anime, isAuthenticated, user]);

  const handleBookmark = useCallback(async () => {
    if (!anime || bookmarkLoading || !isAuthenticated) return;
    setBookmarkLoading(true);
    try {
      if (bookmarked) { await removeBookmark(user.uid, anime.mal_id); setBookmarked(false); }
      else { await addBookmark(user.uid, anime); setBookmarked(true); }
    } catch (err) { console.error('Bookmark failed:', err); }
    finally { setBookmarkLoading(false); }
  }, [anime, bookmarked, bookmarkLoading, isAuthenticated, user]);

  // ---- Episode handlers ----
  const handleEpisodeSelect = useCallback((epNum) => {
    if (epNum !== currentEpisode) setCurrentEpisode(epNum);
  }, [currentEpisode]);

  const handlePrevEpisode = useCallback(() => {
    if (currentEpisode > 1) setCurrentEpisode(prev => prev - 1);
  }, [currentEpisode]);

  const handleNextEpisode = useCallback(() => {
    const max = totalEpisodeCount || anikageEpisodes.length;
    if (currentEpisode < max) setCurrentEpisode(prev => prev + 1);
  }, [currentEpisode, totalEpisodeCount, anikageEpisodes.length]);

  const handleRefresh = useCallback(async () => {
    if (!anikageSlug) return;
    setStreamSources([]);
    setSourceLoading(true);
    setSourceError(null);
    try {
      const data = await getAnikageStreams(anikageSlug, currentEpisode);
      if (!data || !data.sources?.length) { setSourceError('No source available.'); return; }
      setStreamSources(data.sources);
      setIntroTimestamp(data.intro);
      setOutroTimestamp(data.outro);
    } catch (err) { setSourceError('Failed to refresh.'); }
    finally { setSourceLoading(false); }
  }, [anikageSlug, currentEpisode]);

  // ---- Derived ----
  const isLoading = animeLoading || searchLoading;
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

  const episodeList = useMemo(() => {
    if (anikageEpisodes.length > 0) {
      return anikageEpisodes.filter(ep => ep.number > 0).sort((a, b) => a.number - b.number);
    }
    if (typeof totalEps === 'number' && totalEps > 0) {
      return Array.from({ length: Math.min(totalEps, 500) }, (_, i) => ({ number: i + 1, title: `Episode ${i + 1}` }));
    }
    return [];
  }, [anikageEpisodes, totalEps]);

  const maxEpisode = episodeList.length > 0 ? Math.max(...episodeList.map(ep => ep.number)) : 0;
  const currentEpInfo = anikageEpisodes.find(ep => ep.number === currentEpisode);

  if (isLoading) {
    return (
      <div className="streaming-page page-content">
        <div className="page-loader"><div className="spinner" /><span className="page-loader-text">Finding streaming sources...</span></div>
      </div>
    );
  }

  return (
    <div className="streaming-page page-content">
      <div className="streaming-layout container">
        {/* Player + Info */}
        <div className="streaming-main">
          {/* Video Player */}
          <div className="streaming-player">
            {sourceLoading ? (
              <div className="streaming-player-loading">
                <div className="spinner" />
                <span>Loading episode {currentEpisode}...</span>
              </div>
            ) : sourceError ? (
              <div className="streaming-player-error">
                <AlertCircle size={40} />
                <span>{sourceError}</span>
                <button className="btn btn-secondary" onClick={handleRefresh}><RefreshCw size={14} /> Try Again</button>
              </div>
            ) : streamSources.length > 0 ? (
              <HlsPlayer
                sources={streamSources}
                title={`${titleDisplay} - Episode ${currentEpisode}`}
                intro={introTimestamp}
                outro={outroTimestamp}
              />
            ) : searchError ? (
              <div className="streaming-player-error">
                <AlertCircle size={40} /><span>{searchError}</span>
              </div>
            ) : (
              <div className="streaming-player-loading">
                <Play size={48} /><span>Select an episode to start watching</span>
              </div>
            )}
          </div>

          {/* Episode Nav */}
          <div className="streaming-nav">
            <button className="streaming-nav-btn" onClick={handlePrevEpisode} disabled={currentEpisode <= 1}>
              <SkipBack size={16} /> Previous
            </button>
            <span className="streaming-nav-current">Episode {currentEpisode}</span>
            <button className="streaming-nav-btn" onClick={handleNextEpisode} disabled={maxEpisode > 0 && currentEpisode >= maxEpisode}>
              Next <SkipForward size={16} />
            </button>
          </div>

          {/* Current Episode Info */}
          {currentEpInfo && (
            <div className="streaming-ep-info">
              {currentEpInfo.img && <img src={currentEpInfo.img} alt={currentEpInfo.title} className="streaming-ep-thumb" />}
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
              {isAuthenticated && (
                <button className={`btn ${bookmarked ? 'btn-bookmark-active' : 'btn-secondary'}`} onClick={handleBookmark} disabled={bookmarkLoading}>
                  <Bookmark size={14} fill={bookmarked ? 'currentColor' : 'none'} />{bookmarked ? 'Bookmarked' : 'Bookmark'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Episodes Panel */}
        <div className="streaming-episodes-panel">
          <div className="streaming-episodes-header">
            <h3>EPISODES</h3>
            <span className="streaming-episodes-count">
              {episodeList.length > 0 ? `${episodeList.length} available` : episodesLoading ? 'Loading...' : 'N/A'}
            </span>
          </div>

          {episodesLoading ? (
            <div className="streaming-episodes-loading"><div className="spinner" /><span>Loading episodes...</span></div>
          ) : episodeList.length > 0 ? (
            <div className="streaming-episodes-grid">
              {episodeList.map(ep => (
                <button key={ep.number}
                  className={`streaming-episode-btn ${ep.number === currentEpisode ? 'active' : ''}`}
                  onClick={() => handleEpisodeSelect(ep.number)}
                  title={ep.title || `Episode ${ep.number}`}
                >{ep.number}</button>
              ))}
            </div>
          ) : searchError ? (
            <div className="streaming-episodes-empty"><AlertCircle size={24} /><p>{searchError}</p></div>
          ) : (
            <div className="streaming-episodes-empty"><AlertCircle size={24} /><p>No episodes available yet.</p></div>
          )}

          {/* Related */}
          {relatedAnime.length > 0 && (
            <div className="streaming-related">
              <h4 className="streaming-related-title">RELATED</h4>
              <div className="streaming-related-list">
                {relatedAnime.map(r => (
                  <Link key={r.mal_id} to={`/anime/${r.mal_id}`} className="streaming-related-item">
                    <img src={r.images?.jpg?.small_image_url || r.images?.jpg?.image_url || ''} alt={r.title} />
                    <span>{r.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Streaming;
