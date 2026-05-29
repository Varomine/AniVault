// Watch History Service
// Tracks "Continue Watching" state per user

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
export function updateWatchHistory(anime, episode = 1) {
  const history = getWatchHistory();
  const existingIndex = history.findIndex(h => h.mal_id === anime.mal_id);

  const entry = {
    mal_id: anime.mal_id,
    title: anime.title || anime.title_english || '',
    title_english: anime.title_english || '',
    image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || anime.image || '',
    score: anime.score || 0,
    type: anime.type || '',
    episodes: anime.episodes || 0,
    currentEpisode: episode,
    lastWatched: Date.now(),
  };

  if (existingIndex >= 0) {
    history[existingIndex] = entry;
  } else {
    history.unshift(entry);
  }

  // Keep only the last 20 entries
  const trimmed = history.slice(0, 20);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed));
  return trimmed;
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
