import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Play, Bookmark, ExternalLink, Star, Tv, Clock, Calendar, AlertCircle, ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react';
import { searchAnikage, getAnikageEpisodes, getAnikageStreams, getBestSource } from '../../services/animepaheApi';
import { search123Anime, get123AnimeStream } from '../../services/123animeApi';
import { searchAllAnime, getAllAnimeStream } from '../../services/allanimeApi';
import { getHAnimeStreams } from '../../services/hanimeApi';
import { searchAniZone, getAniZoneEpisodes, getAniZoneStream } from '../../services/anizoneApi';
import { getAnimeById, getAnimeRelations, getStatusText, getStatusClass } from '../../services/jikanApi';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { addBookmark, removeBookmark, isBookmarked, updateBookmarkCategory } from '../../services/bookmarkService';
import { updateWatchHistory, saveEpisodeProgress, getEpisodeProgress } from '../../services/watchHistoryService';
import HlsPlayer from '../../components/HlsPlayer/HlsPlayer';
import './Streaming.css';

// Helper functions for matching titles and seasons
function normalizeTitle(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSeasonNumber(titleStr) {
  const norm = titleStr.toLowerCase();
  const seasonMatch = norm.match(/season\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/);
  if (seasonMatch) {
    const val = seasonMatch[1];
    if (/\d+/.test(val)) return parseInt(val);
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    return words[val] || null;
  }
  const ordinalMatch = norm.match(/(\d+)(st|nd|rd|th)\s+season/);
  if (ordinalMatch) {
    return parseInt(ordinalMatch[1]);
  }
  const romanMatch = norm.match(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)$/);
  if (romanMatch) {
    const roman = romanMatch[1];
    const map = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    return map[roman] || null;
  }
  return null;
}

function cleanTitleForBaseComparison(normTitle) {
  return normTitle
    .replace(/season\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/g, '')
    .replace(/(\d+)(st|nd|rd|th)\s+season/g, '')
    .replace(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBestAnikageMatch(animeData, results) {
  if (!animeData || !results || results.length === 0) return null;

  const targetTitles = [
    animeData.title,
    animeData.title_english,
    ...(animeData.title_synonyms || [])
  ].filter(Boolean);

  const scoredResults = results.map(r => {
    const resultTitles = [
      r.title?.english,
      r.title?.romaji,
      typeof r.title === 'string' ? r.title : null
    ].filter(Boolean);

    let bestScore = 0;

    for (const t of targetTitles) {
      const tNorm = normalizeTitle(t);
      const tSeason = getSeasonNumber(t) || 1;
      const tBase = cleanTitleForBaseComparison(tNorm);

      for (const rT of resultTitles) {
        const rNorm = normalizeTitle(rT);
        const rSeason = getSeasonNumber(rNorm) || 1;
        const rBase = cleanTitleForBaseComparison(rNorm);

        if (tSeason !== rSeason) continue;

        if (tBase === rBase) {
          bestScore = Math.max(bestScore, 100);
        } else if (tBase.includes(rBase) || rBase.includes(tBase)) {
          const ratio = Math.min(tBase.length, rBase.length) / Math.max(tBase.length, rBase.length);
          const score = 50 + Math.floor(ratio * 40);
          bestScore = Math.max(bestScore, score);
        } else {
          const tTokens = tBase.split(' ').filter(tk => tk.length > 2);
          const rTokens = rBase.split(' ').filter(tk => tk.length > 2);
          if (tTokens.length > 0 && rTokens.length > 0) {
            const common = tTokens.filter(tk => rTokens.includes(tk));
            const ratioTarget = common.length / tTokens.length;
            const ratioResult = common.length / rTokens.length;
            const maxRatio = Math.max(ratioTarget, ratioResult);
            if (maxRatio >= 0.7) {
              const score = Math.floor(maxRatio * 50);
              bestScore = Math.max(bestScore, score);
            }
          }
        }
      }
    }

    return { result: r, score: bestScore };
  });

  const validMatches = scoredResults.filter(item => item.score > 0);
  if (validMatches.length === 0) return null;

  validMatches.sort((a, b) => b.score - a.score);
  return validMatches[0].result;
}

// Cache slugs to avoid re-searching
const slugCache = new Map();

function Streaming({ onShowAuth }) {
  const { id, episode } = useParams();
  const episodeParam = episode;
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { defaultServer } = useSettings();

  const [anime, setAnime] = useState(null);
  const [animeLoading, setAnimeLoading] = useState(true);

  const [anikageSlug, setAnikageSlug] = useState(null);
  const [anikageEpisodes, setAnikageEpisodes] = useState([]);
  const [totalEpisodeCount, setTotalEpisodeCount] = useState(0);

  const [currentEpisode, setCurrentEpisode] = useState(parseInt(episodeParam) || 1);
  const [streamSources, setStreamSources] = useState([]);
  const [introTimestamp, setIntroTimestamp] = useState(null);
  const [outroTimestamp, setOutroTimestamp] = useState(null);

  const [activeServer, setActiveServer] = useState(defaultServer || 'neko');
  const [showServerModal, setShowServerModal] = useState(false);
  const [selectedNekoSourceIndex, setSelectedNekoSourceIndex] = useState(0);

  const prevDefaultServerRef = useRef(defaultServer);

  // Sync server if default changes in settings
  useEffect(() => {
    if (defaultServer && defaultServer !== prevDefaultServerRef.current) {
      setActiveServer(defaultServer);
      prevDefaultServerRef.current = defaultServer;
    }
  }, [defaultServer]);

  // Reset selected neko source on episode or id change
  useEffect(() => {
    setSelectedNekoSourceIndex(0);
  }, [currentEpisode, id]);

  const [searchLoading, setSearchLoading] = useState(false);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [sourceError, setSourceError] = useState(null);

  const [oneTwoThreeId, setOneTwoThreeId] = useState(null);
  const [oneTwoThreeLoading, setOneTwoThreeLoading] = useState(false);
  const [oneTwoThreeEmbedUrl, setOneTwoThreeEmbedUrl] = useState(null);
  const [oneTwoThreeError, setOneTwoThreeError] = useState(null);

  const [allAnimeId, setAllAnimeId] = useState(null);
  const [allAnimeLoading, setAllAnimeLoading] = useState(false);
  const [allAnimeError, setAllAnimeError] = useState(null);

  const [aniZoneId, setAniZoneId] = useState(null);
  const [aniZoneLoading, setAniZoneLoading] = useState(false);
  const [aniZoneError, setAniZoneError] = useState(null);
  const [aniZoneSubtitles, setAniZoneSubtitles] = useState([]);
  const [aniZoneEpisodes, setAniZoneEpisodes] = useState([]);
  const [aniZoneEpisodesLoading, setAniZoneEpisodesLoading] = useState(false);

  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkCategory, setBookmarkCategory] = useState('');
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [relations, setRelations] = useState([]);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('episodes');

  // Episode pagination state
  const [episodesPage, setEpisodesPage] = useState(0);

  // Watch progress state
  const [initialProgress, setInitialProgress] = useState(null);

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

  const hardsubSources = useMemo(() => {
    const hardsubs = streamSources.filter(s => s.type === 'hardsub' || s.quality?.toLowerCase().includes('hardsub'));
    return hardsubs.length > 0 ? hardsubs : streamSources;
  }, [streamSources]);

  // Search Anikage for matching anime
  async function searchAnikageForAnime(animeData, malId, cancelled) {
    if (malId === 5042) {
      slugCache.set(5042, { slug: '8XzUtDNZYp', totalEpisodes: 12 });
      setAnikageSlug('8XzUtDNZYp');
      setTotalEpisodeCount(12);
      resolvedForId.current = 5042;
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    const titles = [...new Set([
      animeData.title,
      animeData.title_english,
      animeData.title_japanese,
    ].filter(Boolean))];

    let allCandidates = [];
    const seenSlugs = new Set();

    for (const title of titles) {
      if (cancelled) return;
      try {
        const results = await searchAnikage(title);
        if (results && results.length > 0) {
          for (const r of results) {
            if (r.slug && !seenSlugs.has(r.slug)) {
              seenSlugs.add(r.slug);
              allCandidates.push(r);
            }
          }
        }
      } catch (err) {
        console.error(`Search failed for "${title}":`, err);
      }
    }

    const match = findBestAnikageMatch(animeData, allCandidates);

    if (match) {
      // Cache it
      slugCache.set(malId, { slug: match.slug, totalEpisodes: match.totalEpisodes || match.currentEpisode || 0 });
      setAnikageSlug(match.slug);
      setTotalEpisodeCount(match.totalEpisodes || match.currentEpisode || 0);
      resolvedForId.current = malId;
      setSearchLoading(false);
      return;
    }

    if (!cancelled) {
      setSearchError('This server does not have that anime.');
      setSearchLoading(false);
    }
  }

  // Search 123Anime for matching anime
  async function searchOneTwoThreeForAnime(animeData, cancelled) {
    setOneTwoThreeLoading(true);
    setOneTwoThreeError(null);

    const titles = [...new Set([
      animeData.title,
      animeData.title_english,
      animeData.title_japanese,
    ].filter(Boolean))];

    for (const title of titles) {
      if (cancelled) return;
      try {
        const match = await search123Anime(title);
        if (match && match.id) {
          setOneTwoThreeId(match.id);
          setOneTwoThreeLoading(false);
          return;
        }
      } catch (err) {
        console.error(`123Anime search failed for "${title}":`, err);
      }
    }

    if (!cancelled) {
      setOneTwoThreeError('Anime not found on 123Anime server.');
      setOneTwoThreeLoading(false);
    }
  }

  // Search AllAnime for matching anime
  async function searchAllAnimeForAnime(animeData, cancelled) {
    setAllAnimeLoading(true);
    setAllAnimeError(null);

    const titles = [...new Set([
      animeData.title_english,
      animeData.title,
      animeData.title_japanese,
    ].filter(Boolean))];

    for (const title of titles) {
      if (cancelled) return;
      try {
        const match = await searchAllAnime(title);
        if (match && match.id) {
          setAllAnimeId(match.id);
          setAllAnimeLoading(false);
          return;
        }
      } catch (err) {
        console.error(`AllAnime search failed for "${title}":`, err);
      }
    }

    if (!cancelled) {
      setAllAnimeError('Anime not found on AllAnime server.');
      setAllAnimeLoading(false);
    }
  }

  // Search AniZone for matching anime
  async function searchAniZoneForAnime(animeData, cancelled) {
    setAniZoneLoading(true);
    setAniZoneError(null);

    const titles = [...new Set([
      animeData.title_english,
      animeData.title,
      animeData.title_japanese
    ].filter(Boolean))];

    for (const title of titles) {
      if (cancelled) return;
      try {
        const match = await searchAniZone(title);
        if (match && match.id) {
          setAniZoneId(match.id);
          setAniZoneLoading(false);
          fetchAniZoneEpisodesList(match.id, cancelled);
          return;
        }
      } catch (err) {
        console.error(`AniZone search failed for "${title}":`, err);
      }
    }

    if (!cancelled) {
      setAniZoneError('Anime not found on AniZone.');
      setAniZoneLoading(false);
    }
  }

  // Fetch episodes for AniZone
  async function fetchAniZoneEpisodesList(aniZoneId, cancelled) {
    setAniZoneEpisodesLoading(true);
    try {
      const data = await getAniZoneEpisodes(aniZoneId);
      if (cancelled) return;
      setAniZoneEpisodes(data.episodes || []);
    } catch (err) {
      console.error('AniZone episodes fetch failed:', err);
    } finally {
      if (!cancelled) setAniZoneEpisodesLoading(false);
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
      setOneTwoThreeId(null);
      setOneTwoThreeEmbedUrl(null);
      setOneTwoThreeError(null);
      setAllAnimeId(null);
      setAllAnimeError(null);
      setAniZoneId(null);
      setAniZoneError(null);
      setAniZoneSubtitles([]);
      setAniZoneEpisodes([]);
    });
    resolvedForId.current = null;

    // Check slug cache
    if (malId === 5042) {
      slugCache.set(5042, { slug: '8XzUtDNZYp', totalEpisodes: 12 });
      Promise.resolve().then(() => {
        if (cancelled) return;
        setAnikageSlug('8XzUtDNZYp');
        setTotalEpisodeCount(12);
      });
    } else if (slugCache.has(malId)) {
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
        if (malId === 5042) {
          // Already overridden
        } else if (!slugCache.has(malId)) {
          searchAnikageForAnime(data.data, malId, cancelled);
        }

        // Search 123Anime
        searchOneTwoThreeForAnime(data.data, cancelled);

        // Search AllAnime
        searchAllAnimeForAnime(data.data, cancelled);

        // Search AniZone
        searchAniZoneForAnime(data.data, cancelled);
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
    let cancelled = false;

    const fetchStream = async () => {
      if (activeServer === 'neko' || activeServer === 'miko') {
        if (!anikageSlug) return;
        setSourceLoading(true);
        setSourceError(null);
        setStreamSources([]);
        setIntroTimestamp(null);
        setOutroTimestamp(null);

        try {
          const data = await getAnikageStreams(anikageSlug, currentEpisode, activeServer);
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
      } else if (activeServer === '123') {
        if (!oneTwoThreeId) return;
        setSourceLoading(true);
        setSourceError(null);
        setOneTwoThreeEmbedUrl(null);
        setStreamSources([]);

        try {
          const data = await get123AnimeStream(oneTwoThreeId, currentEpisode);
          if (cancelled) return;
          if (!data || !data.streaming_link) {
            setSourceError('No streaming source for this episode.');
            return;
          }
          setOneTwoThreeEmbedUrl(data.streaming_link);
          if (data.direct_m3u8) {
            setStreamSources([{ quality: '123Anime', streamUrl: data.direct_m3u8 }]);
          }
        } catch (err) {
          if (!cancelled) { console.error('123Anime stream fetch error:', err); setSourceError('Failed to load stream.'); }
        } finally {
          if (!cancelled) setSourceLoading(false);
        }
      } else if (activeServer === 'allanime') {
        if (!allAnimeId) return;
        setSourceLoading(true);
        setSourceError(null);
        setStreamSources([]);

        try {
          const data = await getAllAnimeStream(allAnimeId, currentEpisode);
          if (cancelled) return;
          if (!data || !data.episode_url) {
            setSourceError('No streaming source for this episode.');
            return;
          }
          setStreamSources([{ quality: 'AllAnime', streamUrl: data.episode_url }]);
        } catch (err) {
          if (!cancelled) { console.error('AllAnime stream fetch error:', err); setSourceError('Failed to load stream.'); }
        } finally {
          if (!cancelled) setSourceLoading(false);
        }
      } else if (activeServer === 'hanime') {
        if (!anime) return;
        setSourceLoading(true);
        setSourceError(null);
        setStreamSources([]);

        try {
          const data = await getHAnimeStreams(anime, currentEpisode);
          if (cancelled) return;
          if (!data || !data.streams || data.streams.length === 0) {
            setSourceError('No streaming source available for this episode on HAnime.');
            return;
          }
          setStreamSources(data.streams);
        } catch (err) {
          if (!cancelled) { console.error('HAnime stream fetch error:', err); setSourceError('Failed to load stream.'); }
        } finally {
          if (!cancelled) setSourceLoading(false);
        }
      } else if (activeServer === 'zone') {
        if (!aniZoneId) return;
        setSourceLoading(true);
        setSourceError(null);
        setStreamSources([]);
        setAniZoneSubtitles([]);

        try {
          const epMatch = aniZoneEpisodes.find(ep => ep.number === currentEpisode);
          const epId = epMatch ? epMatch.id : null;
          const data = await getAniZoneStream(aniZoneId, currentEpisode, epId);
          if (cancelled) return;
          if (!data || !data.streams || data.streams.length === 0) {
            setSourceError('No streaming source for this episode on Zone.');
            return;
          }
          setStreamSources(data.streams);
          setAniZoneSubtitles(data.subtitles || []);
        } catch (err) {
          if (!cancelled) { console.error('Zone stream fetch error:', err); setSourceError('Failed to load stream.'); }
        } finally {
          if (!cancelled) setSourceLoading(false);
        }
      }
    };

    fetchStream();
    return () => { cancelled = true; };
  }, [activeServer, anikageSlug, oneTwoThreeId, allAnimeId, aniZoneId, aniZoneEpisodes, currentEpisode, anime]);

  // ---- Related anime (relations from Jikan API, only anime) ----
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setRelationsLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await getAnimeRelations(id);
        if (!cancelled) {
          setRelations(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch relations:', err);
      } finally {
        if (!cancelled) setRelationsLoading(false);
      }
    }, 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [id]);

  const animeRelations = useMemo(() => {
    return relations
      .map(rel => ({
        ...rel,
        entry: rel.entry.filter(entry => entry.type === 'anime')
      }))
      .filter(rel => rel.entry.length > 0);
  }, [relations]);

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

  // ---- Fetch watch progress asynchronously ----
  useEffect(() => {
    let active = true;
    async function fetchProgress() {
      setInitialProgress(null);
      try {
        const time = await getEpisodeProgress(parseInt(id), currentEpisode);
        if (active) {
          setInitialProgress(time || 0);
        }
      } catch (err) {
        console.error('Failed to get episode progress:', err);
        if (active) setInitialProgress(0);
      }
    }
    fetchProgress();
    return () => { active = false; };
  }, [id, currentEpisode, user]);

  // ---- Bookmark ----
  useEffect(() => {
    if (!anime || !isAuthenticated || !user) return;
    getBookmarks(user.uid).then(list => {
      const item = list.find(b => b.mal_id === anime.mal_id);
      if (item) {
        setBookmarked(true);
        setBookmarkCategory(item.category || 'Plan to Watch');
      } else {
        setBookmarked(false);
        setBookmarkCategory('');
      }
    }).catch(() => {
      setBookmarked(false);
      setBookmarkCategory('');
    });
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
        setBookmarkCategory('');
      } else {
        await addBookmark(user.uid, anime, 'Plan to Watch');
        setBookmarked(true);
        setBookmarkCategory('Plan to Watch');
      }
    } catch (err) { console.error(err); }
    finally { setBookmarkLoading(false); }
  }, [anime, bookmarked, bookmarkLoading, isAuthenticated, user, onShowAuth]);

  const handleCategoryChange = async (newCategory) => {
    if (!isAuthenticated || !anime || bookmarkLoading) return;
    setBookmarkLoading(true);
    try {
      const success = await updateBookmarkCategory(user.uid, anime.mal_id, newCategory);
      if (success) {
        setBookmarkCategory(newCategory);
      }
    } catch (err) {
      console.error('Failed to change bookmark category:', err);
    } finally {
      setBookmarkLoading(false);
    }
  };



  // ---- Episode list (from Anikage or generated) ----
  const episodeList = useMemo(() => {
    // Determine the count of episodes that have actually aired
    let count = 0;
    if (anikageEpisodes.length > 0) {
      count = anikageEpisodes.length;
    } else if (totalEpisodeCount > 0) {
      count = totalEpisodeCount;
    } else if (anime) {
      if (anime.status === 'Finished Airing') {
        count = anime.episodes || 1;
      } else {
        // Currently Airing or Upcoming: only show up to currentEpisode
        count = currentEpisode;
      }
    }

    if (activeServer === 'neko' || activeServer === 'miko') {
      if (anikageEpisodes.length > 0) {
        return anikageEpisodes.filter(ep => ep.number > 0).sort((a, b) => a.number - b.number);
      }
      if (count > 0) {
        // Allow up to 1500 episodes for long running anime
        return Array.from({ length: Math.min(count, 1500) }, (_, i) => ({ number: i + 1, title: `Episode ${i + 1}` }));
      }
      return [];
    } else if (activeServer === 'zone') {
      if (aniZoneEpisodes.length > 0) {
        return aniZoneEpisodes.map(ep => ({
          number: ep.number,
          title: ep.title,
          img: ep.img
        })).sort((a, b) => a.number - b.number);
      }
      if (count > 0) {
        return Array.from({ length: Math.min(count, 1500) }, (_, i) => ({ number: i + 1, title: `Episode ${i + 1}` }));
      }
      return [];
    } else {
      // For Koto: we always show up to the currently aired count
      return Array.from({ length: Math.max(count, currentEpisode) }, (_, i) => {
        const existing = anikageEpisodes.find(ep => ep.number === i + 1);
        return {
          number: i + 1,
          title: existing?.title || `Episode ${i + 1}`,
          img: existing?.img || null
        };
      });
    }
  }, [anikageEpisodes, aniZoneEpisodes, totalEpisodeCount, anime, activeServer, currentEpisode]);

  const maxEpisode = episodeList.length > 0 ? Math.max(...episodeList.map(ep => ep.number)) : 0;

  const currentEpInfo = useMemo(() => {
    if (activeServer === 'zone') {
      const existing = aniZoneEpisodes.find(ep => ep.number === currentEpisode);
      if (existing) return existing;
    }
    const existing = anikageEpisodes.find(ep => ep.number === currentEpisode);
    if (existing) return existing;
    return {
      number: currentEpisode,
      title: `Episode ${currentEpisode}`,
      img: anime?.images?.jpg?.large_image_url || null,
      description: ''
    };
  }, [anikageEpisodes, aniZoneEpisodes, activeServer, currentEpisode, anime]);

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
    if (anime && (streamSources.length > 0 || activeServer === 'koto' || activeServer === 'zone' || (activeServer === '123' && oneTwoThreeEmbedUrl))) {
      updateWatchHistory(anime, currentEpisode, currentEpInfo?.img);
    }
  }, [anime, currentEpisode, streamSources, currentEpInfo, activeServer, oneTwoThreeEmbedUrl]);

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
                allow="autoplay; fullscreen; picture-in-picture"
                sandbox="allow-scripts allow-same-origin"
                title={`${titleDisplay} - Episode ${currentEpisode} (Koto)`}
              />
            ) : activeServer === '123' ? (
              oneTwoThreeLoading || sourceLoading || initialProgress === null ? (
                <div className="streaming-player-loading">
                  <div className="spinner" />
                  <span>{oneTwoThreeLoading ? 'Finding anime on 123Anime...' : `Loading ep ${currentEpisode}...`}</span>
                </div>
              ) : oneTwoThreeError || sourceError ? (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>{oneTwoThreeError || sourceError}</span>
                </div>
              ) : oneTwoThreeEmbedUrl ? (
                <iframe
                  src={oneTwoThreeEmbedUrl}
                  className="streaming-iframe"
                  allowFullScreen
                  scrolling="no"
                  allow="autoplay; fullscreen; picture-in-picture"
                  sandbox="allow-scripts allow-same-origin"
                  title={`${titleDisplay} - Episode ${currentEpisode} (123Anime)`}
                />
              ) : (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>No streaming source available for 123Anime.</span>
                </div>
              )
            ) : activeServer === 'allanime' ? (
              allAnimeLoading || sourceLoading || initialProgress === null ? (
                <div className="streaming-player-loading">
                  <div className="spinner" />
                  <span>{allAnimeLoading ? 'Finding anime on AllAnime...' : `Loading ep ${currentEpisode}...`}</span>
                </div>
              ) : allAnimeError || sourceError ? (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>{allAnimeError || sourceError}</span>
                </div>
              ) : streamSources.length > 0 ? (
                IS_IOS && bestSource ? (
                  <iframe
                    src={`/embed.html?sources=${encodeURIComponent(JSON.stringify(streamSources))}&poster=${encodeURIComponent(anime?.images?.jpg?.large_image_url || '')}&t=${initialProgress}`}
                    className="streaming-iframe"
                    allowFullScreen
                    scrolling="no"
                    allow="autoplay; fullscreen; picture-in-picture"
                    title={`${titleDisplay} - Episode ${currentEpisode} (AllAnime)`}
                  />
                ) : (
                  <HlsPlayer
                    key={`allanime-${id}-${currentEpisode}`}
                    sources={streamSources}
                    title={`${titleDisplay} - Episode ${currentEpisode}`}
                    intro={introTimestamp}
                    outro={outroTimestamp}
                    initialTime={initialProgress}
                    onProgress={(time, duration) => {
                      saveEpisodeProgress(parseInt(id), currentEpisode, time, duration);
                    }}
                  />
                )
              ) : (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>No streaming source available for AllAnime.</span>
                </div>
              )
            ) : activeServer === 'hanime' ? (
              sourceLoading || initialProgress === null ? (
                <div className="streaming-player-loading">
                  <div className="spinner" />
                  <span>{`Loading ep ${currentEpisode} on HAnime...`}</span>
                </div>
              ) : sourceError ? (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>{sourceError}</span>
                </div>
              ) : streamSources.length > 0 ? (
                IS_IOS && bestSource ? (
                  <iframe
                    src={`/embed.html?sources=${encodeURIComponent(JSON.stringify(streamSources))}&poster=${encodeURIComponent(anime?.images?.jpg?.large_image_url || '')}&t=${initialProgress}`}
                    className="streaming-iframe"
                    allowFullScreen
                    scrolling="no"
                    allow="autoplay; fullscreen; picture-in-picture"
                    title={`${titleDisplay} - Episode ${currentEpisode} (HAnime)`}
                  />
                ) : (
                  <HlsPlayer
                    key={`hanime-${id}-${currentEpisode}`}
                    sources={streamSources}
                    title={`${titleDisplay} - Episode ${currentEpisode}`}
                    intro={introTimestamp}
                    outro={outroTimestamp}
                    initialTime={initialProgress}
                    onProgress={(time, duration) => {
                      saveEpisodeProgress(parseInt(id), currentEpisode, time, duration);
                    }}
                  />
                )
              ) : (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>No streaming source available for HAnime.</span>
                </div>
              )
            ) : activeServer === 'zone' ? (
              sourceLoading || initialProgress === null ? (
                <div className="streaming-player-loading">
                  <div className="spinner" />
                  <span>{`Loading ep ${currentEpisode} on Zone...`}</span>
                </div>
              ) : sourceError ? (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>{sourceError}</span>
                </div>
              ) : streamSources.length > 0 ? (
                <iframe
                  src={`/embed.html?sources=${encodeURIComponent(JSON.stringify(streamSources))}&subtitles=${encodeURIComponent(JSON.stringify(aniZoneSubtitles))}&poster=${encodeURIComponent(anime?.images?.jpg?.large_image_url || '')}&t=${initialProgress}`}
                  className="streaming-iframe"
                  allowFullScreen
                  scrolling="no"
                  allow="autoplay; fullscreen; picture-in-picture"
                  title={`${titleDisplay} - Episode ${currentEpisode} (Zone)`}
                />
              ) : (
                <div className="streaming-player-error">
                  <AlertCircle size={40} />
                  <span>No streaming source available for Zone.</span>
                </div>
              )
            ) : sourceLoading || searchLoading || initialProgress === null ? (
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
              activeServer === 'neko' ? (
                hardsubSources.length > 0 ? (
                  <iframe
                    src={hardsubSources[selectedNekoSourceIndex]?.embedUrl || hardsubSources[0]?.embedUrl}
                    className="streaming-iframe"
                    allowFullScreen
                    scrolling="no"
                    allow="autoplay; fullscreen; picture-in-picture"
                    sandbox="allow-same-origin allow-scripts"
                    title={`${titleDisplay} - Episode ${currentEpisode} (Neko)`}
                  />
                ) : (
                  <div className="streaming-player-error">
                    <AlertCircle size={40} />
                    <span>No sources available on Neko.</span>
                  </div>
                )
              ) : IS_IOS && bestSource ? (
                <iframe
                  src={`/embed.html?sources=${encodeURIComponent(JSON.stringify(streamSources))}&poster=${encodeURIComponent(anime?.images?.jpg?.large_image_url || '')}&t=${initialProgress}`}
                  className="streaming-iframe"
                  allowFullScreen
                  scrolling="no"
                  allow="autoplay; fullscreen; picture-in-picture"
                  title={`${titleDisplay} - Episode ${currentEpisode}`}
                />
              ) : (
                <HlsPlayer
                  key={`${activeServer}-${id}-${currentEpisode}`}
                  sources={streamSources}
                  title={`${titleDisplay} - Episode ${currentEpisode}`}
                  intro={introTimestamp}
                  outro={outroTimestamp}
                  initialTime={initialProgress}
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

          {activeServer === 'neko' && hardsubSources.length > 1 && (
            <div className="streaming-neko-sources">
              <span className="neko-sources-label">Source:</span>
              <div className="neko-sources-list">
                {hardsubSources.map((src, idx) => (
                  <button
                    key={idx}
                    className={`neko-source-btn ${selectedNekoSourceIndex === idx ? 'active' : ''}`}
                    onClick={() => setSelectedNekoSourceIndex(idx)}
                  >
                    {src.quality.replace('hardsub ', '').replace('softsub ', '')}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              <div className="streaming-bookmark-wrapper">
                <button className={`btn ${bookmarked ? 'btn-bookmark-active' : 'btn-secondary'}`} onClick={handleBookmark} disabled={bookmarkLoading}>
                  {bookmarkLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Bookmark size={14} fill={bookmarked ? 'currentColor' : 'none'} />
                  )}
                  {bookmarked ? 'Bookmarked' : 'Bookmark'}
                </button>
                {bookmarked && (
                  <select
                    className="bookmark-category-select"
                    value={bookmarkCategory}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    disabled={bookmarkLoading}
                  >
                    <option value="Watching">Watching</option>
                    <option value="Plan to Watch">Plan to Watch</option>
                    <option value="Completed">Completed</option>
                    <option value="Dropped">Dropped</option>
                    <option value="On Hold">On Hold</option>
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Episodes Panel */}
        <div className="streaming-episodes-panel">
          <div className="streaming-panel-tabs">
            <button 
              className={`streaming-panel-tab ${activeTab === 'episodes' ? 'active' : ''}`}
              onClick={() => setActiveTab('episodes')}
            >
              Episodes
            </button>
            <button 
              className={`streaming-panel-tab ${activeTab === 'relations' ? 'active' : ''}`}
              onClick={() => setActiveTab('relations')}
            >
              Relations
            </button>
          </div>

          {activeTab === 'episodes' ? (
            <>
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
              ) : ((activeServer === 'neko' || activeServer === 'miko') && searchError) ? (
                <div className="streaming-episodes-empty"><AlertCircle size={24} /><p>{searchError}</p></div>
              ) : (
                <div className="streaming-episodes-empty"><AlertCircle size={24} /><p>No episodes available.</p></div>
              )}
            </>
          ) : (
            <>
              <div className="streaming-episodes-header">
                <h3>RELATIONS</h3>
                <span className="streaming-episodes-count">
                  {relationsLoading ? 'Loading...' : animeRelations.length > 0 ? `${animeRelations.length} types` : 'N/A'}
                </span>
              </div>

              {relationsLoading ? (
                <div className="streaming-episodes-loading"><div className="spinner" /><span>Loading relations...</span></div>
              ) : animeRelations.length > 0 ? (
                <div className="streaming-relations-container">
                  {animeRelations.map((rel, idx) => (
                    <div key={idx} className="streaming-relation-group">
                      <span className="streaming-relation-type">{rel.relation}</span>
                      <div className="streaming-relation-entries">
                        {rel.entry.map(entry => (
                          <Link key={entry.mal_id} to={`/anime/${entry.mal_id}`} className="streaming-relation-card glass-effect">
                            <span className="streaming-relation-title">{entry.name}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="streaming-episodes-empty"><p>No related anime found.</p></div>
              )}
            </>
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
                className={`server-modal-option ${activeServer === 'neko' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('neko');
                  setShowServerModal(false);
                }}
              >
                <div className="server-modal-details">
                  <span className="server-name">neko</span>
                  <div className="server-tags">
                    <span className="server-tag best">Fast</span>
                  </div>
                </div>
                <span className="server-status-dot" />
              </button>
              <button
                type="button"
                className={`server-modal-option ${activeServer === 'miko' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('miko');
                  setShowServerModal(false);
                }}
              >
                <div className="server-modal-details">
                  <span className="server-name">Miko</span>
                </div>
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
                <div className="server-modal-details">
                  <span className="server-name">Koto</span>
                  <div className="server-tags">
                    <span className="server-tag best">Fast</span>
                  </div>
                </div>
                <span className="server-status-dot" />
              </button>
              <button
                type="button"
                className={`server-modal-option ${activeServer === '123' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('123');
                  setShowServerModal(false);
                }}
              >
                <div className="server-modal-details">
                  <span className="server-name">123</span>
                </div>
                <span className="server-status-dot" />
              </button>
              <button
                type="button"
                className={`server-modal-option ${activeServer === 'allanime' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('allanime');
                  setShowServerModal(false);
                }}
              >
                <div className="server-modal-details">
                  <span className="server-name">AllAnime</span>
                </div>
                <span className="server-status-dot" />
              </button>
              <button
                type="button"
                className={`server-modal-option ${activeServer === 'hanime' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('hanime');
                  setShowServerModal(false);
                }}
              >
                <div className="server-modal-details">
                  <span className="server-name">HAnime</span>
                  <div className="server-tags">
                    <span className="server-tag hentai">18+</span>
                  </div>
                </div>
                <span className="server-status-dot" />
              </button>
              <button
                type="button"
                className={`server-modal-option ${activeServer === 'zone' ? 'active' : ''}`}
                onClick={() => {
                  setActiveServer('zone');
                  setShowServerModal(false);
                }}
              >
                <div className="server-modal-details">
                  <span className="server-name">Zone</span>
                </div>
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
