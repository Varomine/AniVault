// Watch History Service
// Tracks "Continue Watching" state per user and episode progress

const LOCAL_KEY = 'anivault_watch_history';

// Get watch history from localStorage
export function getWatchHistory() {
  try {
    const data = localStorage.getItem(LOCAL_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Add or update watch history entry
export function updateWatchHistory(anime, episode = 1, episodeImage = null) {
  const history = getWatchHistory();
  const existingIndex = history.findIndex(h => h.mal_id === anime.mal_id);

  // Preserve existing progress map if it exists
  const existingProgress = existingIndex >= 0 ? (history[existingIndex].progress || {}) : {};

  const entry = {
    mal_id: anime.mal_id,
    title: anime.title || anime.title_english || '',
    title_english: anime.title_english || '',
    image: episodeImage || anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || anime.image || '',
    score: anime.score || 0,
    type: anime.type || '',
    episodes: anime.episodes || 0,
    currentEpisode: episode,
    lastWatched: Date.now(),
    progress: existingProgress,
  };

  if (existingIndex >= 0) {
    history.splice(existingIndex, 1);
  }
  history.unshift(entry);

  // Keep only the last 20 entries
  const trimmed = history.slice(0, 20);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed));
  return trimmed;
}

// Save specific episode play progress
export function saveEpisodeProgress(animeId, episodeNumber, currentTime, duration) {
  const history = getWatchHistory();
  const existingIndex = history.findIndex(h => h.mal_id === animeId);
  if (existingIndex < 0) return;

  const entry = history[existingIndex];
  if (!entry.progress) {
    entry.progress = {};
  }

  // If watched > 95% of the episode, reset progress to 0 so next time plays from start
  const isFinished = duration > 0 && (currentTime / duration) > 0.95;

  entry.progress[episodeNumber] = {
    currentTime: isFinished ? 0 : currentTime,
    duration,
    lastUpdated: Date.now(),
  };

  entry.currentEpisode = episodeNumber;
  entry.lastWatched = Date.now();

  history.splice(existingIndex, 1);
  history.unshift(entry);

  localStorage.setItem(LOCAL_KEY, JSON.stringify(history));
}

// Get play progress time for a specific episode
export function getEpisodeProgress(animeId, episodeNumber) {
  const history = getWatchHistory();
  const entry = history.find(h => h.mal_id === animeId);
  if (entry && entry.progress && entry.progress[episodeNumber]) {
    return entry.progress[episodeNumber].currentTime;
  }
  return 0;
}

// Remove from watch history
export function removeFromWatchHistory(animeId) {
  const history = getWatchHistory().filter(h => h.mal_id !== animeId);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(history));
  return history;
}

// Clear all watch history
export function clearWatchHistory() {
  localStorage.removeItem(LOCAL_KEY);
  return [];
}

// Check if anime is in watch history
export function isInWatchHistory(animeId) {
  return getWatchHistory().some(h => h.mal_id === animeId);
}

// Get the last watched episode for a specific anime
export function getLastWatchedEpisode(animeId) {
  const entry = getWatchHistory().find(h => h.mal_id === animeId);
  return entry ? entry.currentEpisode : null;
}
