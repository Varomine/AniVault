import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Star,
  Clock,
  Calendar,
  BookmarkPlus,
  Eye as EyeIcon,
} from 'lucide-react';
import {
  getBannerAnime,
  getTrendingAnime,
  getCurrentSeasonAnime,
  getMostFavoriteAnime,
  getUpcomingAnime,
  getStatusText,
  getStatusClass,
} from '../../services/jikanApi';
import { getWatchHistory } from '../../services/watchHistoryService';
import AnimeRow from '../../components/AnimeRow/AnimeRow';
import './Home.css';

function Home() {
  const navigate = useNavigate();

  // Hero banner state
  const [bannerAnime, setBannerAnime] = useState([]);
  const [currentBanner, setCurrentBanner] = useState(0);
  const [bannerLoading, setBannerLoading] = useState(true);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Section data state
  const [continueWatching, setContinueWatching] = useState([]);
  const [trending, setTrending] = useState([]);
  const [seasonal, setSeasonal] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [upcoming, setUpcoming] = useState([]);

  // Loading states
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [seasonalLoading, setSeasonalLoading] = useState(true);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

  // Auto-rotate timer refs
  const autoRotateRef = useRef(null);
  const restartTimeoutRef = useRef(null);

  // Start auto-rotate
  const startAutoRotate = useCallback(() => {
    if (autoRotateRef.current) clearInterval(autoRotateRef.current);
    autoRotateRef.current = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentBanner((prev) =>
          prev >= bannerAnime.length - 1 ? 0 : prev + 1
        );
        setSynopsisExpanded(false);
        setIsTransitioning(false);
      }, 500);
    }, 8000);
  }, [bannerAnime.length]);

  // Stop auto-rotate and restart after delay
  const handleManualNavigation = useCallback(
    (newIndex) => {
      if (autoRotateRef.current) clearInterval(autoRotateRef.current);
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);

      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentBanner(newIndex);
        setSynopsisExpanded(false);
        setIsTransitioning(false);
      }, 500);

      restartTimeoutRef.current = setTimeout(() => {
        startAutoRotate();
      }, 10000);
    },
    [startAutoRotate]
  );

  const goToPrev = useCallback(() => {
    const newIndex =
      currentBanner <= 0 ? bannerAnime.length - 1 : currentBanner - 1;
    handleManualNavigation(newIndex);
  }, [currentBanner, bannerAnime.length, handleManualNavigation]);

  const goToNext = useCallback(() => {
    const newIndex =
      currentBanner >= bannerAnime.length - 1 ? 0 : currentBanner + 1;
    handleManualNavigation(newIndex);
  }, [currentBanner, bannerAnime.length, handleManualNavigation]);

  const goToDot = useCallback(
    (index) => {
      if (index === currentBanner) return;
      handleManualNavigation(index);
    },
    [currentBanner, handleManualNavigation]
  );

  // Fetch banner anime
  useEffect(() => {
    let cancelled = false;

    async function fetchBanner() {
      try {
        const response = await getBannerAnime();
        if (!cancelled && response?.data) {
          setBannerAnime(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch banner anime:', err);
      } finally {
        if (!cancelled) setBannerLoading(false);
      }
    }

    fetchBanner();
    return () => {
      cancelled = true;
    };
  }, []);

  // Start auto-rotate when banner data is ready
  useEffect(() => {
    if (bannerAnime.length > 1) {
      startAutoRotate();
    }
    return () => {
      if (autoRotateRef.current) clearInterval(autoRotateRef.current);
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    };
  }, [bannerAnime.length, startAutoRotate]);

  // Fetch section data with staggered delays
  useEffect(() => {
    let cancelled = false;

    // Continue Watching (local, no API call)
    const history = getWatchHistory();
    setContinueWatching(history);

    async function fetchSections() {
      // Trending
      try {
        const trendingRes = await getTrendingAnime();
        if (!cancelled && trendingRes?.data) setTrending(trendingRes.data);
      } catch (err) {
        console.error('Failed to fetch trending:', err);
      } finally {
        if (!cancelled) setTrendingLoading(false);
      }

      // Delay for rate limiting
      await new Promise((r) => setTimeout(r, 400));

      // Current Season
      try {
        const seasonRes = await getCurrentSeasonAnime();
        if (!cancelled && seasonRes?.data) setSeasonal(seasonRes.data);
      } catch (err) {
        console.error('Failed to fetch seasonal:', err);
      } finally {
        if (!cancelled) setSeasonalLoading(false);
      }

      await new Promise((r) => setTimeout(r, 400));

      // Most Favorite
      try {
        const favRes = await getMostFavoriteAnime();
        if (!cancelled && favRes?.data) setFavorites(favRes.data);
      } catch (err) {
        console.error('Failed to fetch favorites:', err);
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }

      await new Promise((r) => setTimeout(r, 400));

      // Upcoming
      try {
        const upRes = await getUpcomingAnime();
        if (!cancelled && upRes?.data) setUpcoming(upRes.data);
      } catch (err) {
        console.error('Failed to fetch upcoming:', err);
      } finally {
        if (!cancelled) setUpcomingLoading(false);
      }
    }

    fetchSections();
    return () => {
      cancelled = true;
    };
  }, []);

  // Current anime for hero
  const anime = bannerAnime[currentBanner];
  const bannerImage =
    anime?.images?.jpg?.large_image_url ||
    anime?.images?.jpg?.image_url ||
    '';
  const japaneseTitle = anime?.title_japanese || '';
  const mainTitle = anime?.title_english || anime?.title || '';
  const score = anime?.score || 0;
  const type = anime?.type || '';
  const season = anime?.season
    ? anime.season.charAt(0).toUpperCase() + anime.season.slice(1)
    : '';
  const year = anime?.year || '';
  const duration = anime?.duration || '';
  const status = anime?.status || '';
  const genres = anime?.genres || [];
  const synopsis = anime?.synopsis || '';
  const trailer = anime?.trailer || {};

  return (
    <div className="home-page">
      {/* ===== HERO BANNER ===== */}
      <section className="hero-banner">
        {bannerLoading ? (
          <div className="hero-banner-skeleton">
            <div className="spinner" />
          </div>
        ) : (
          <>
            {/* Background Image */}
            <div
              className={`hero-bg ${isTransitioning ? 'hero-bg-exit' : 'hero-bg-enter'}`}
              style={{ backgroundImage: `url(${bannerImage})` }}
            />

            {/* Gradient Overlay */}
            <div className="hero-gradient-overlay" />

            {/* Content */}
            <div
              className={`hero-content ${isTransitioning ? 'hero-content-exit' : 'hero-content-enter'}`}
            >
              {japaneseTitle && (
                <span className="hero-japanese-title">{japaneseTitle}</span>
              )}

              <h1 className="hero-title">{mainTitle}</h1>

              {/* Info Row */}
              <div className="hero-info-row">
                {score > 0 && (
                  <span className="hero-score-badge">
                    <Star size={14} />
                    {score.toFixed(1)}
                  </span>
                )}
                {type && <span className="hero-type-badge">{type}</span>}
                {(season || year) && (
                  <span className="hero-season-badge">
                    <Calendar size={13} />
                    {season} {year}
                  </span>
                )}
                {duration && (
                  <span className="hero-duration-badge">
                    <Clock size={13} />
                    {duration}
                  </span>
                )}
                {status && (
                  <span
                    className={`status-badge ${getStatusClass(status)}`}
                  >
                    {getStatusText(status)}
                  </span>
                )}
              </div>

              {/* Genres */}
              {genres.length > 0 && (
                <div className="hero-genres">
                  {genres.slice(0, 5).map((genre) => (
                    <span key={genre.mal_id} className="genre-tag">
                      {genre.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Synopsis */}
              {synopsis && (
                <div className="hero-synopsis-wrapper">
                  <p
                    className={`hero-synopsis ${synopsis.length > 180 ? (synopsisExpanded ? 'expanded' : 'clamped') : ''}`}
                  >
                    {synopsis}
                  </p>
                  {synopsis.length > 180 && (
                    <button
                      className="hero-read-more"
                      onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                    >
                      {synopsisExpanded
                        ? 'SHOW LESS'
                        : 'READ FULL SYNOPSIS'}
                    </button>
                  )}
                </div>
              )}

              {/* CTA Buttons */}
              <div className="hero-actions">
                <button
                  className="btn btn-primary hero-btn"
                  onClick={() => navigate(`/watch/${anime?.mal_id}`)}
                >
                  <Play size={18} fill="currentColor" />
                  Watch Episode 1
                </button>

                {trailer?.url && (
                  <a
                    href={trailer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary hero-btn"
                  >
                    <EyeIcon size={18} />
                    Watch Trailer
                  </a>
                )}

                <button
                  className="btn btn-secondary hero-btn"
                  onClick={() => navigate(`/anime/${anime?.mal_id}`)}
                >
                  <BookmarkPlus size={18} />
                  Bookmark
                </button>
              </div>
            </div>

            {/* Navigation Arrows */}
            {bannerAnime.length > 1 && (
              <>
                <button
                  className="hero-arrow hero-arrow-left"
                  onClick={goToPrev}
                  aria-label="Previous slide"
                >
                  <ChevronLeft size={28} />
                </button>
                <button
                  className="hero-arrow hero-arrow-right"
                  onClick={goToNext}
                  aria-label="Next slide"
                >
                  <ChevronRight size={28} />
                </button>
              </>
            )}

            {/* Dot Indicators */}
            {bannerAnime.length > 1 && (
              <div className="hero-dots">
                {bannerAnime.map((_, index) => (
                  <button
                    key={index}
                    className={`hero-dot ${index === currentBanner ? 'active' : ''}`}
                    onClick={() => goToDot(index)}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ===== ANIME ROW SECTIONS ===== */}
      <div className="home-sections">
        {/* Continue Watching */}
        {continueWatching.length > 0 && (
          <AnimeRow
            title="Continue Watching"
            anime={continueWatching}
            loading={false}
            viewAllLink="/browse?filter=history"
          />
        )}

        {/* Trending Now */}
        <AnimeRow
          title="Trending Now"
          anime={trending}
          loading={trendingLoading}
          viewAllLink="/browse?filter=airing"
        />

        {/* Popular This Season */}
        <AnimeRow
          title="Popular This Season"
          anime={seasonal}
          loading={seasonalLoading}
          viewAllLink="/browse?filter=season"
        />

        {/* Most Favorite */}
        <AnimeRow
          title="Most Favorite"
          anime={favorites}
          loading={favoritesLoading}
          viewAllLink="/browse?filter=favorite"
        />

        {/* Coming Soon */}
        <AnimeRow
          title="Coming Soon"
          anime={upcoming}
          loading={upcomingLoading}
          viewAllLink="/browse?filter=upcoming"
        />
      </div>
    </div>
  );
}

export default Home;
