import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Star, Play, Bookmark, Clock, Calendar, Tv, ExternalLink } from 'lucide-react';
import { getAnimeById, getAnimeCharacters, getAnimeRecommendations, getAnimeEpisodes, getStatusText, getStatusClass } from '../../services/jikanApi';
import AnimeRow from '../../components/AnimeRow/AnimeRow';
import { useAuth } from '../../contexts/AuthContext';
import { addBookmark, removeBookmark, isBookmarked, addLocalBookmark, removeLocalBookmark, isLocalBookmarked } from '../../services/bookmarkService';
import './AnimeDetail.css';

function AnimeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const [anime, setAnime] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [charsLoading, setCharsLoading] = useState(true);
  const [recsLoading, setRecsLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [error, setError] = useState(null);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);

  useEffect(() => {
    async function fetchAnime() {
      setLoading(true); setError(null);
      try {
        const data = await getAnimeById(id);
        setAnime(data.data);
      } catch (err) {
        console.error('Failed to fetch anime:', err);
        setError('Failed to load anime details.');
      } finally { setLoading(false); }
    }
    fetchAnime();
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    async function fetchCharacters() {
      setCharsLoading(true);
      try { const data = await getAnimeCharacters(id); setCharacters(data.data || []); }
      catch (err) { console.error('Failed to fetch characters:', err); }
      finally { setCharsLoading(false); }
    }
    fetchCharacters();
  }, [id]);

  useEffect(() => {
    async function fetchRecommendations() {
      setRecsLoading(true);
      try { const data = await getAnimeRecommendations(id); setRecommendations(data.data || []); }
      catch (err) { console.error('Failed to fetch recommendations:', err); }
      finally { setRecsLoading(false); }
    }
    const timer = setTimeout(fetchRecommendations, 500);
    return () => clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    async function fetchEpisodes() {
      setEpisodesLoading(true);
      try { const data = await getAnimeEpisodes(id); setEpisodes(data.data || []); }
      catch (err) { console.error('Failed to fetch episodes:', err); }
      finally { setEpisodesLoading(false); }
    }
    const timer = setTimeout(fetchEpisodes, 900);
    return () => clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    async function checkBookmark() {
      if (!anime) return;
      if (isAuthenticated && user) {
        const result = await isBookmarked(user.uid, anime.mal_id);
        setBookmarked(result);
      } else { setBookmarked(isLocalBookmarked(anime.mal_id)); }
    }
    checkBookmark();
  }, [anime, isAuthenticated, user]);

  const handleBookmark = useCallback(async () => {
    if (!anime || bookmarkLoading) return;
    setBookmarkLoading(true);
    try {
      if (bookmarked) {
        if (isAuthenticated && user) await removeBookmark(user.uid, anime.mal_id);
        else removeLocalBookmark(anime.mal_id);
        setBookmarked(false);
      } else {
        if (isAuthenticated && user) await addBookmark(user.uid, anime);
        else addLocalBookmark(anime);
        setBookmarked(true);
      }
    } catch (err) { console.error('Bookmark action failed:', err); }
    finally { setBookmarkLoading(false); }
  }, [anime, bookmarked, bookmarkLoading, isAuthenticated, user]);

  const displayCharacters = characters
    .map(char => { const jpVA = char.voice_actors?.find(va => va.language === 'Japanese'); return { ...char, jpVA }; })
    .slice(0, 10);

  // Transform recommendations to look like Jikan anime objects for AnimeRow
  const recAnimeList = recommendations.slice(0, 15).map(rec => {
    const e = rec.entry;
    return {
      mal_id: e.mal_id,
      title: e.title,
      title_english: e.title,
      images: e.images,
      score: null,
      type: null,
      episodes: null,
      trailer: null,
    };
  });

  if (loading) {
    return (<div className="detail-page page-content"><div className="page-loader"><div className="spinner" /><span className="page-loader-text">Loading anime details...</span></div></div>);
  }
  if (error || !anime) {
    return (<div className="detail-page page-content"><div className="page-loader"><span className="page-loader-text">{error || 'Anime not found.'}</span><button className="btn btn-secondary" onClick={() => navigate(-1)}>Go Back</button></div></div>);
  }

  const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '';
  const bannerUrl = anime.images?.webp?.large_image_url || posterUrl;
  const title = anime.title_english || anime.title || '';
  const japaneseTitle = anime.title_japanese || '';
  const score = anime.score || 'N/A';
  const type = anime.type || '';
  const season = anime.season ? `${anime.season.charAt(0).toUpperCase() + anime.season.slice(1)}` : '';
  const year = anime.year || anime.aired?.prop?.from?.year || '';
  const seasonYear = [season, year].filter(Boolean).join(' ');
  const duration = anime.duration || '';
  const status = anime.status || '';
  const synopsis = anime.synopsis || 'No synopsis available.';
  const genres = anime.genres || [];
  const totalEpisodes = anime.episodes || '?';
  const trailerUrl = anime.trailer?.url || '';

  return (
    <div className="detail-page page-content">
      {/* Hero Section */}
      <section className="detail-hero">
        <div className="detail-hero-bg" style={{ backgroundImage: `url(${bannerUrl})` }} />
        <div className="detail-hero-overlay" />
        <div className="detail-hero-content container">
          <div className="detail-poster-wrapper animate-fade-in-up">
            <img src={posterUrl} alt={title} className="detail-poster" loading="eager" />
          </div>
          <div className="detail-info animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            {japaneseTitle && <span className="detail-japanese-title">{japaneseTitle}</span>}
            <h1 className="detail-title">{title}</h1>
            <div className="detail-meta-row">
              {score !== 'N/A' && <span className="detail-meta-badge detail-score"><Star size={14} />{score}</span>}
              {type && <span className="detail-meta-badge"><Tv size={14} />{type}</span>}
              {seasonYear && <span className="detail-meta-badge"><Calendar size={14} />{seasonYear}</span>}
              {duration && <span className="detail-meta-badge"><Clock size={14} />{duration}</span>}
              {totalEpisodes !== '?' && <span className="detail-meta-badge">{totalEpisodes} eps</span>}
              {status && <span className={`status-badge ${getStatusClass(status)}`}>{getStatusText(status)}</span>}
            </div>
            {genres.length > 0 && <div className="detail-genres">{genres.map(g => <span key={g.mal_id} className="genre-tag">{g.name}</span>)}</div>}
            <div className={`detail-synopsis ${synopsis.length > 300 ? (synopsisExpanded ? 'expanded' : 'clamped') : ''}`}>
              <p>{synopsis}</p>
            </div>
            {synopsis.length > 300 && <button className="detail-synopsis-toggle" onClick={() => setSynopsisExpanded(!synopsisExpanded)}>{synopsisExpanded ? 'SHOW LESS' : 'READ FULL SYNOPSIS'}</button>}
            <div className="detail-actions">
              <Link to={`/watch/${anime.mal_id}`} className="btn btn-primary"><Play size={16} /> Watch Episode 1</Link>
              {trailerUrl && <a href={trailerUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary"><ExternalLink size={16} /> Watch Trailer</a>}
              <button className={`btn ${bookmarked ? 'btn-bookmark-active' : 'btn-secondary'}`} onClick={handleBookmark} disabled={bookmarkLoading}>
                <Bookmark size={16} fill={bookmarked ? 'currentColor' : 'none'} />{bookmarked ? 'Bookmarked' : 'Bookmark'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Episodes Section */}
      <section className="detail-episodes-section container">
        <h2 className="detail-section-title">
          Episodes
          {totalEpisodes !== '?' && <span className="detail-episode-count">{totalEpisodes} episodes</span>}
        </h2>
        {episodesLoading ? (
          <div className="detail-episodes-loading">
            <div className="spinner" style={{ width: 24, height: 24 }} />
            <span>Loading episodes...</span>
          </div>
        ) : (
          <div className="detail-episodes-grid">
            {(episodes.length > 0
              ? episodes
              : Array.from(
                  { length: typeof totalEpisodes === 'number' ? Math.min(totalEpisodes, 100) : 0 },
                  (_, i) => ({ mal_id: i + 1, title: `Episode ${i + 1}` })
                )
            ).map((ep, idx) => {
              const epNum = ep.mal_id || idx + 1;
              return (
                <Link key={epNum} to={`/watch/${anime.mal_id}/${epNum}`}
                  className="detail-episode-btn" title={ep.title || `Episode ${epNum}`}>
                  {epNum}
                </Link>
              );
            })}
            {totalEpisodes === '?' && episodes.length === 0 && (
              <p className="detail-no-data">No episode data available yet.</p>
            )}
          </div>
        )}
      </section>

      {/* Characters & Cast */}
      <section className="detail-characters-section container">
        <h2 className="detail-section-title">Characters & Cast</h2>
        {charsLoading ? (
          <div className="detail-chars-loading">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton detail-character-skeleton" />)}
          </div>
        ) : displayCharacters.length > 0 ? (
          <div className="detail-characters-grid">
            {displayCharacters.map(char => (
              <div key={char.character.mal_id} className="detail-character-card">
                <div className="detail-character-main">
                  <img src={char.character.images?.jpg?.image_url || ''} alt={char.character.name} className="detail-character-image" loading="lazy" />
                  <div className="detail-character-info">
                    <span className="detail-character-name">{char.character.name}</span>
                    <span className={`detail-character-role ${char.role?.toLowerCase()}`}>{char.role}</span>
                  </div>
                </div>
                {char.jpVA && (
                  <div className="detail-va">
                    <div className="detail-va-info">
                      <span className="detail-va-name">{char.jpVA.person?.name || ''}</span>
                      <span className="detail-va-lang">JP VA</span>
                    </div>
                    <img src={char.jpVA.person?.images?.jpg?.image_url || ''} alt={char.jpVA.person?.name || ''} className="detail-va-image" loading="lazy" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <p className="detail-no-data">No character data available.</p>}
      </section>

      {/* You May Also Like — using AnimeRow for arrows */}
      <section className="detail-recommendations container">
        {recAnimeList.length > 0 || recsLoading ? (
          <AnimeRow title="You May Also Like" anime={recAnimeList} loading={recsLoading} />
        ) : (
          <>
            <h2 className="detail-section-title">You May Also Like</h2>
            <p className="detail-no-data">No recommendations available.</p>
          </>
        )}
      </section>
    </div>
  );
}

export default AnimeDetail;
